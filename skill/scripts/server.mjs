/**
 * The durable loop: `ziggy serve <slug…>` keeps one process alive per host and re-runs the
 * tenant loops on a timer — feed stories → scheduled posts (daily) and the tenant report.
 * Every run is a plain child CLI invocation, so keys resolve exactly like a manual run:
 * POSTPROXY_API_KEY_<SLUG> in the environment, or hush on a dev machine. GET /healthz
 * reports the last runs so Docker or a probe can tell the loop is alive.
 *
 *   POSTPROXY_API_KEY_RAGUSA=…  — that tenant's Postproxy key (never logged, never read back)
 *   ZIGGY_DAILY_EVERY_S / ZIGGY_REPORT_EVERY_S — intervals, seconds (defaults below)
 *   ZIGGY_REPORT_HOOK — shell command run once per report cycle with ZIGGY_REPORT_TENANT
 *                       (the comma list of tenants) and ZIGGY_REPORT_TEXT (all digests
 *                       joined by a blank line) in its environment (e.g. a grog telegram-send)
 *
 * A tenant with `events.schedule` in tenant.json also gets the weekly events job:
 * `ziggy events <slug> --week --publish --notify` once per ISO week, at the scheduled local
 * time or later that same day (a container down at 07:00 catches up the same Monday, never on
 * a later day). The week is recorded in $ZIGGY_HOME/state before the run starts, so a restart
 * never runs it twice. It runs with --no-daily too (`events: false` turns it off) and waits
 * while the same tenant's daily run is going; it does not see a round run by hand
 * (`docker exec … round`), which may overlap it.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSlug, loadTenant, ziggyHome } from "./config.mjs";
import { EVENTS_DEFAULTS, addDays, daysBetween, localDay, weekdayOf } from "./events.mjs";
import { localAt } from "./round.mjs";

const CLI = fileURLToPath(new URL("../index.js", import.meta.url));

export const SERVER_DEFAULTS = { dailyEveryS: 1800, reportEveryS: 14400, port: 8080, eventsCheckEveryS: 60 };

/** What the weekly events job runs: the week's reel, published, with the summary to the hook. */
export const EVENTS_JOB_ARGS = ["--week", "--publish", "--notify"];

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * `tenant.json → events.schedule` ({ "weekday": "mon", "time": "07:00", "tz": "Europe/Rome" }) as
 * { weekday (0 = Monday), time, tz, label }, or null when the tenant has none. The time zone
 * falls back to `events.tz`. A malformed block throws.
 */
export function eventsSchedule(tenant) {
  const s = tenant.events?.schedule;
  if (!s) return null;
  const weekday = WEEKDAYS.indexOf(String(s.weekday || "").toLowerCase().slice(0, 3));
  if (weekday < 0) throw new Error(`events.schedule.weekday must be one of ${WEEKDAYS.join(", ")} (got ${JSON.stringify(s.weekday)})`);
  const time = String(s.time || "");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`events.schedule.time must be HH:MM (got ${JSON.stringify(s.time)})`);
  const tz = s.tz || tenant.events.tz || EVENTS_DEFAULTS.tz;
  return { weekday, time, tz, label: `${WEEKDAYS[weekday]} ${time} ${tz}` };
}

/** The ISO 8601 week of a calendar day, "2026-W44": the week's Thursday decides the year. */
export function isoWeek(day) {
  const thursday = addDays(day, 3 - weekdayOf(day));
  const year = thursday.slice(0, 4);
  return `${year}-W${String(Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1).padStart(2, "0")}`;
}

/**
 * Pure: is the weekly run due at `now`? Only on the scheduled weekday (in the schedule's time
 * zone), from the scheduled time to the end of that day, and only when `lastWeek` is not this
 * ISO week. Returns { day, at, week } when due, else null.
 */
export function eventsDue(sched, now, lastWeek) {
  const day = localDay(now, sched.tz);
  if (weekdayOf(day) !== sched.weekday) return null;
  const at = localAt(day, sched.time, sched.tz);
  const week = isoWeek(day);
  return now.getTime() >= at && week !== lastWeek ? { day, at: new Date(at).toISOString(), week } : null;
}

/** When the weekly run fires next: `now` when it is due, else the next scheduled time not run yet. */
export function nextEventsRun(sched, now, lastWeek) {
  if (eventsDue(sched, now, lastWeek)) return now;
  const today = localDay(now, sched.tz);
  for (let i = 0; i <= 14; i++) {
    const day = addDays(today, i);
    if (weekdayOf(day) !== sched.weekday || isoWeek(day) === lastWeek) continue;
    const at = localAt(day, sched.time, sched.tz);
    if (at > now.getTime()) return new Date(at);
  }
  return null;
}

/** The weekly job's record per tenant: $ZIGGY_HOME/state/<slug>-events-schedule.json. */
export function eventsStateFile(slug) {
  return join(ziggyHome(), "state", `${assertSlug(slug)}-events-schedule.json`);
}

export function readEventsState(slug) {
  const file = eventsStateFile(slug);
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf8")) || {}; } catch { return {}; }
}

export function writeEventsState(slug, record) {
  const file = eventsStateFile(slug);
  mkdirSync(join(ziggyHome(), "state"), { recursive: true });
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return file;
}

/** The per-tenant key variable: tenant "my-brand" reads POSTPROXY_API_KEY_MY_BRAND. */
export function keyEnvFor(slug) {
  return `POSTPROXY_API_KEY_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

export function defaultSpawn({ slug, cmd, slugs, args = [] }) {
  // per-tenant isolation: the global POSTPROXY_API_KEY never leaks to another tenant's child;
  // it passes through only when this process serves exactly that one tenant
  const env = { ...process.env };
  const own = process.env[keyEnvFor(slug)];
  delete env.POSTPROXY_API_KEY;
  if (own) env.POSTPROXY_API_KEY = own;
  else if (slugs.length === 1 && process.env.POSTPROXY_API_KEY) env.POSTPROXY_API_KEY = process.env.POSTPROXY_API_KEY;
  const child = spawn(process.execPath, [CLI, cmd, slug, ...args], { env });

  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  return new Promise((resolve) => {
    child.on("error", (e) => resolve({ ok: false, code: -1, stdout, stderr: String(e) }));
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

export function serve({ slugs, dailyEveryS = SERVER_DEFAULTS.dailyEveryS, reportEveryS = SERVER_DEFAULTS.reportEveryS, port = SERVER_DEFAULTS.port, events = true, eventsCheckEveryS = SERVER_DEFAULTS.eventsCheckEveryS, once = false, spawnImpl = defaultSpawn, log = console.error, now = () => new Date() } = {}) {
  if (!slugs?.length) throw new Error("serve needs at least one tenant slug");
  const tenants = slugs.map(loadTenant);
  const state = Object.fromEntries(tenants.map((t) => [t.slug, {}]));
  const timers = [];
  const stamp = () => now().toISOString();

  async function runOnce(slug, kind, { args = [], okCodes = [0] } = {}) {
    const st = (state[slug][kind] ||= { runs: 0, lastOk: null, error: null, running: false });
    if (st.running) return (log(`serve: ${slug} ${kind} still running — skipping this tick`), null);
    st.running = true;
    st.runs += 1;
    log(`serve: ${slug} ${kind} → running`);
    try {
      const r = await Promise.resolve(spawnImpl({ slug, cmd: kind, slugs, args }));
      for (const line of (r.stdout || "").trim().split("\n").filter(Boolean)) log(`serve: ${slug} ${kind} | ${line}`);
      const ok = r.ok || okCodes.includes(r.code);
      st.error = ok ? null : (r.stderr || "").trim().split("\n")[0] || `exit ${r.code}`;
      if (!ok) log(`serve: ${slug} ${kind} ✗ ${st.error}`);
      else st.lastOk = stamp();
      return { ...r, ok, text: ok ? (r.stdout || "").trim() : null };
    } catch (e) {
      st.error = e.message;
      log(`serve: ${slug} ${kind} ✗ ${e.message}`);
      return null;
    } finally {
      st.running = false;
    }
  }

  /* Reports go out together: one timer for all tenants, one hook call with every
     tenant's digest in a single text (ZIGGY_REPORT_TENANT = the comma list). A skipped
     or failed tenant does not block the others — its digest is simply missing. */
  let reportsRunning = false;
  async function runReports() {
    if (reportsRunning) return log(`serve: reports still running — skipping this tick`);
    reportsRunning = true;
    try {
      const texts = [];
      for (const t of tenants) {
        const r = await runOnce(t.slug, "report");
        if (r?.text) texts.push(r.text);
      }
      if (process.env.ZIGGY_REPORT_HOOK && texts.length) {
        await hook(tenants.map((t) => t.slug).join(","), texts.join("\n\n"))
          .catch((e) => log(`serve: report hook ✗ ${e.message}`));
      }
    } finally {
      reportsRunning = false;
    }
  }

  function hook(slug, text) {
    return new Promise((resolve, reject) => {
      const child = spawn("sh", ["-c", process.env.ZIGGY_REPORT_HOOK], { env: { ...process.env, ZIGGY_REPORT_TENANT: slug, ZIGGY_REPORT_TEXT: text } });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`hook exited ${code}`))));
    });
  }

  // dailyEveryS 0 (--no-daily): reports only. Story selection, summaries and scheduling stay
  // with a Claude session that runs `ziggy daily`/`ziggy post` itself — no autonomous publishing
  const runs = [];
  if (dailyEveryS > 0) {
    for (const t of tenants) {
      runs.push(runOnce(t.slug, "daily"));
      if (!once) timers.push(setInterval(() => runOnce(t.slug, "daily"), dailyEveryS * 1000));
    }
  }
  runs.push(runReports());
  if (!once) timers.push(setInterval(runReports, reportEveryS * 1000));

  // the weekly events job, independent of --no-daily: a check every eventsCheckEveryS, a run
  // at most once per ISO week (the week is written before the run, so a restart never repeats it)
  for (const t of events ? tenants : []) {
    let sched;
    try { sched = eventsSchedule(t); } catch (e) {
      state[t.slug].events = { error: e.message };
      log(`serve: ${t.slug} events ✗ ${e.message}`);
      continue;
    }
    if (!sched) continue;
    const st = (state[t.slug].events = { runs: 0, lastOk: null, error: null, running: false, schedule: sched.label, lastWeek: readEventsState(t.slug).lastWeek || null, next: null });
    const refresh = () => { st.next = nextEventsRun(sched, now(), st.lastWeek)?.toISOString() || null; };
    refresh();
    log(`serve: ${t.slug} events → weekly ${sched.label}, next ${st.next}`);
    const tick = async () => {
      try {
        st.lastWeek = readEventsState(t.slug).lastWeek || null;
        const due = st.running ? null : eventsDue(sched, now(), st.lastWeek);
        if (!due) return refresh();
        if (state[t.slug].daily?.running) return log(`serve: ${t.slug} events due — waiting for the daily run to finish`);
        const startedAt = stamp();
        writeEventsState(t.slug, { lastWeek: due.week, day: due.day, startedAt });
        st.lastWeek = due.week;
        refresh();
        const r = await runOnce(t.slug, "events", { args: EVENTS_JOB_ARGS, okCodes: [0, 3] });
        writeEventsState(t.slug, { lastWeek: due.week, day: due.day, startedAt, finishedAt: stamp(), code: r?.code ?? null });
      } catch (e) {
        st.error = e.message;
        log(`serve: ${t.slug} events ✗ ${e.message}`);
      }
    };
    runs.push(tick());
    if (!once) timers.push(setInterval(tick, eventsCheckEveryS * 1000));
  }

  let http = null;
  if (!once && port) {
    http = createServer((req, res) => {
      if (req.url !== "/healthz") { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, now: stamp(), tenants: state }));
    });
    http.listen(port, "0.0.0.0", () => log(`serve: healthz on :${port} — tenants: ${tenants.map((t) => t.slug).join(", ")}`));
  }

  const stop = async () => {
    for (const t of timers) clearInterval(t);
    if (http) await new Promise((r) => http.close(r));
  };
  if (!once) {
    process.once("SIGTERM", () => stop().then(() => process.exit(0)));
    process.once("SIGINT", () => stop().then(() => process.exit(0)));
  }

  return { state, stop, boot: Promise.all(runs), address: () => http?.address() || null };
}
