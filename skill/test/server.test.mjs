import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { eventsDue, eventsSchedule, isoWeek, keyEnvFor, nextEventsRun, readEventsState, serve } from "../scripts/server.mjs";
import { API_KEY, makeWorld, startMockPostproxy } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;

const quiet = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("the per-tenant key variable name uppercases and sanitizes the slug", () => {
  assert.equal(keyEnvFor("ragusa"), "POSTPROXY_API_KEY_RAGUSA");
  assert.equal(keyEnvFor("my-brand.v2"), "POSTPROXY_API_KEY_MY_BRAND_V2");
});

test("serve runs daily + report per tenant at boot and then on its timers", async () => {
  const calls = [];
  const spawnImpl = async ({ slug, cmd }) => {
    calls.push({ slug, cmd });
    return { ok: true, code: 0, stdout: `${cmd} done`, stderr: "" };
  };
  const r = serve({ slugs: ["acme"], dailyEveryS: 0.05, reportEveryS: 0.07, port: 0, spawnImpl, log: quiet });
  assert.equal(r.address(), null, "port 0 disables the health endpoint");
  await r.boot;
  assert.deepEqual(calls.map((c) => c.cmd).sort(), ["daily", "report"]);
  await sleep(280);
  await r.stop();
  const later = calls.filter((c) => c.cmd === "daily").length;
  assert.ok(later >= 3, `daily re-runs on its timer (${later})`);
  assert.equal(r.state.acme.daily.error, null);
  assert.ok(r.state.acme.report.lastOk);
});

test("--no-daily (dailyEveryS 0): reports only, the daily loop never runs on its own", async () => {
  const calls = [];
  const spawnImpl = async ({ slug, cmd }) => { calls.push({ slug, cmd }); return { ok: true, code: 0, stdout: `${cmd} done`, stderr: "" }; };
  const r = serve({ slugs: ["acme"], dailyEveryS: 0, reportEveryS: 0.05, port: 0, spawnImpl, log: quiet });
  await r.boot;
  await sleep(150);
  await r.stop();
  assert.ok(calls.length >= 2, "reports still run on their timer");
  assert.deepEqual([...new Set(calls.map((c) => c.cmd))], ["report"]);
});

test("a failing run is recorded and the loop goes on", async () => {
  const spawnImpl = async ({ cmd }) => ({ ok: cmd !== "daily", code: cmd === "daily" ? 1 : 0, stdout: "", stderr: "boom\nmore" });
  const r = serve({ slugs: ["acme"], dailyEveryS: 0.05, reportEveryS: 0.05, port: 0, spawnImpl, log: quiet });
  await r.boot;
  await sleep(120);
  await r.stop();
  assert.equal(r.state.acme.daily.error, "boom");
  assert.equal(r.state.acme.report.error, null);
});

test("GET /healthz reports the tenants' last runs", async () => {
  const spawnImpl = async () => ({ ok: true, code: 0, stdout: "", stderr: "" });
  const r = serve({ slugs: ["acme"], dailyEveryS: 3600, reportEveryS: 3600, port: 0, spawnImpl, log: quiet });
  await r.boot;
  // port 0 disables http — re-serve with a fixed free port to exercise the endpoint
  await r.stop();
  const s = serve({ slugs: ["acme"], dailyEveryS: 3600, reportEveryS: 3600, port: 18080, spawnImpl, log: quiet });
  await s.boot;
  const res = await fetch("http://127.0.0.1:18080/healthz");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.tenants.acme.daily.lastOk);
  const missing = await fetch("http://127.0.0.1:18080/nope");
  assert.equal(missing.status, 404);
  await s.stop();
});

test("the report hook receives the report text per tenant", async () => {
  const file = join(world.root, "hook-out.txt");
  process.env.ZIGGY_REPORT_HOOK = `printf '%s\\n' "$ZIGGY_REPORT_TENANT: $ZIGGY_REPORT_TEXT" >> ${file}`;
  try {
    const spawnImpl = async ({ cmd }) => ({ ok: true, code: 0, stdout: cmd === "report" ? "the report body" : "", stderr: "" });
    const r = serve({ slugs: ["acme"], once: true, spawnImpl, log: quiet });
    await r.boot;
    await r.stop();
    await sleep(50);
    assert.equal(readFileSync(file, "utf8"), "acme: the report body\n");
  } finally {
    delete process.env.ZIGGY_REPORT_HOOK;
    rmSync(file, { force: true });
  }
});

test("with several tenants the hook fires once with every digest combined", async () => {
  const file = join(world.root, "hook-out.txt");
  // a second tenant in the test world
  const bdir = join(world.repo, "tenants", "beta");
  mkdirSync(bdir, { recursive: true });
  writeFileSync(join(bdir, "tenant.json"), JSON.stringify({ name: "Beta", site: "https://beta.example/", language: "en" }));
  process.env.ZIGGY_REPORT_HOOK = `printf '%s\\n' "$ZIGGY_REPORT_TENANT: $ZIGGY_REPORT_TEXT" >> ${file}`;
  try {
    const spawnImpl = async ({ slug, cmd }) => ({ ok: true, code: 0, stdout: cmd === "report" ? `report of ${slug}` : "", stderr: "" });
    const r = serve({ slugs: ["acme", "beta"], once: true, spawnImpl, log: quiet });
    await r.boot;
    await r.stop();
    await sleep(50);
    // one hook call, not two: the tenants' digests in a single message
    assert.equal(readFileSync(file, "utf8"), "acme,beta: report of acme\n\nreport of beta\n");
  } finally {
    delete process.env.ZIGGY_REPORT_HOOK;
    rmSync(file, { force: true });
  }
});

test("key isolation: the per-slug variable wins, a shared one passes only when serving one tenant", async () => {
  const mock = await startMockPostproxy({ posts: {} });
  try {
    const { defaultSpawn } = await import("../scripts/server.mjs");
    process.env.ZIGGY_POSTPROXY_BASE_URL = mock.baseUrl;
    process.env.POSTPROXY_API_KEY = "wrong-key";
    process.env[keyEnvFor("acme")] = API_KEY;
    try {
      const one = await defaultSpawn({ slug: "acme", cmd: "status", slugs: ["acme", "other"] });
      assert.equal(one.ok, true, one.stderr);
      delete process.env[keyEnvFor("acme")];
      const shared = await defaultSpawn({ slug: "acme", cmd: "status", slugs: ["acme"] });
      assert.equal(shared.ok, true, "one tenant alone may use the shared POSTPROXY_API_KEY");
      const mixed = await defaultSpawn({ slug: "acme", cmd: "status", slugs: ["acme", "other"] });
      assert.equal(mixed.ok, false, "with several tenants the shared key never leaks into a child");
    } finally {
      delete process.env.POSTPROXY_API_KEY;
      delete process.env[keyEnvFor("acme")];
      delete process.env.ZIGGY_POSTPROXY_BASE_URL;
    }
  } finally {
    await mock.close();
  }
});

/* ── the weekly events job ─────────────────────────────────────────────── */

const MONDAY_0700 = { weekday: "mon", time: "07:00", tz: "Europe/Rome" };
const SCHED = eventsSchedule({ events: { schedule: MONDAY_0700 } });
const at = (iso) => new Date(iso);

test("events schedule: parsed from tenant.json, tz falls back to events.tz, a bad block throws", () => {
  assert.deepEqual(SCHED, { weekday: 0, time: "07:00", tz: "Europe/Rome", label: "mon 07:00 Europe/Rome" });
  assert.equal(eventsSchedule({ events: {} }), null);
  assert.equal(eventsSchedule({}), null);
  assert.equal(eventsSchedule({ events: { tz: "Europe/Lisbon", schedule: { weekday: "Friday", time: "18:30" } } }).label, "fri 18:30 Europe/Lisbon");
  assert.throws(() => eventsSchedule({ events: { schedule: { weekday: "lun", time: "07:00" } } }), /weekday/);
  assert.throws(() => eventsSchedule({ events: { schedule: { weekday: "mon", time: "7:00" } } }), /HH:MM/);
});

test("ISO weeks: the week's Thursday decides the year", () => {
  assert.equal(isoWeek("2026-10-19"), "2026-W43");
  assert.equal(isoWeek("2026-10-25"), "2026-W43"); // Sunday closes the week
  assert.equal(isoWeek("2026-10-26"), "2026-W44");
  assert.equal(isoWeek("2027-01-01"), "2026-W53");
  assert.equal(isoWeek("2027-01-04"), "2027-W01");
  assert.equal(isoWeek("2025-12-29"), "2026-W01");
});

test("events schedule: Monday 07:00 in Rome on both sides of the DST change, never before the time", () => {
  // 19 Oct: CEST, 07:00 = 05:00Z
  assert.equal(eventsDue(SCHED, at("2026-10-19T04:59:00Z"), null), null);
  assert.deepEqual(eventsDue(SCHED, at("2026-10-19T05:00:00Z"), null), { day: "2026-10-19", at: "2026-10-19T05:00:00.000Z", week: "2026-W43" });
  // 26 Oct, the day after the change: CET, 07:00 = 06:00Z — 05:30Z is still 06:30 in Rome
  assert.equal(eventsDue(SCHED, at("2026-10-26T05:30:00Z"), "2026-W43"), null);
  assert.equal(eventsDue(SCHED, at("2026-10-26T06:00:00Z"), "2026-W43").week, "2026-W44");
  // back to summer time: 29 Mar 2027, 07:00 = 05:00Z
  assert.equal(eventsDue(SCHED, at("2027-03-29T04:59:00Z"), null), null);
  assert.equal(eventsDue(SCHED, at("2027-03-29T05:00:00Z"), null).at, "2027-03-29T05:00:00.000Z");
  assert.equal(nextEventsRun(SCHED, at("2026-10-24T12:00:00Z"), "2026-W43").toISOString(), "2026-10-26T06:00:00.000Z");
  assert.equal(nextEventsRun(SCHED, at("2027-03-27T12:00:00Z"), null).toISOString(), "2027-03-29T05:00:00.000Z");
});

test("events schedule: once per ISO week, a catch-up later the same Monday, never on Tuesday", () => {
  assert.ok(eventsDue(SCHED, at("2026-10-26T15:00:00Z"), "2026-W43"), "down at 07:00, back at 16:00: runs the same Monday");
  assert.ok(eventsDue(SCHED, at("2026-10-26T22:59:00Z"), "2026-W43"), "23:59 in Rome is still Monday");
  assert.equal(eventsDue(SCHED, at("2026-10-26T15:00:00Z"), "2026-W44"), null, "already ran this week");
  assert.equal(eventsDue(SCHED, at("2026-10-26T23:00:00Z"), "2026-W43"), null, "Tuesday 00:00 in Rome: no catch-up");
  assert.equal(eventsDue(SCHED, at("2026-10-27T08:00:00Z"), null), null, "Tuesday: no catch-up, even never run");
  assert.equal(nextEventsRun(SCHED, at("2026-10-26T15:00:00Z"), "2026-W44").toISOString(), "2026-11-02T06:00:00.000Z");
  assert.equal(nextEventsRun(SCHED, at("2026-10-27T08:00:00Z"), "2026-W43").toISOString(), "2026-11-02T06:00:00.000Z");
  assert.equal(nextEventsRun(SCHED, at("2026-10-26T15:00:00Z"), "2026-W43").toISOString(), "2026-10-26T15:00:00.000Z", "due: now");
});

function scheduledTenant(slug, schedule = MONDAY_0700) {
  const dir = join(world.repo, "tenants", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tenant.json"), JSON.stringify({ name: "Ragusa Buzz", site: "https://ragusa.buzz/", language: "it", events: { tz: "Europe/Rome", schedule } }));
  return slug;
}
const recorder = (result = { ok: true, code: 0, stdout: "🗓️ done", stderr: "" }) => {
  const calls = [];
  const spawnImpl = async ({ slug, cmd, args }) => { calls.push({ slug, cmd, args }); return typeof result === "function" ? result(cmd) : result; };
  return { calls, spawnImpl, events: () => calls.filter((c) => c.cmd === "events") };
};

test("serve --no-daily runs the weekly events job once on Monday after 07:00 and records the week; a restart does not repeat it", async () => {
  const slug = scheduledTenant("evserve");
  const rec = recorder();
  const clock = { now: at("2026-10-26T07:30:00Z") }; // 08:30 in Rome
  const r = serve({ slugs: [slug], dailyEveryS: 0, reportEveryS: 3600, eventsCheckEveryS: 0.02, port: 0, spawnImpl: rec.spawnImpl, log: quiet, now: () => clock.now });
  await r.boot;
  await sleep(120);
  await r.stop();
  assert.deepEqual(rec.events(), [{ slug, cmd: "events", args: ["--week", "--publish", "--notify"] }]);
  assert.ok(!rec.calls.some((c) => c.cmd === "daily"), "--no-daily still means no daily");
  const st = readEventsState(slug);
  assert.equal(st.lastWeek, "2026-W44");
  assert.equal(st.code, 0);
  assert.ok(st.startedAt && st.finishedAt);
  assert.equal(r.state[slug].events.lastWeek, "2026-W44");
  assert.equal(r.state[slug].events.next, "2026-11-02T06:00:00.000Z");
  assert.equal(r.state[slug].events.schedule, "mon 07:00 Europe/Rome");

  // the container restarts the same Monday: the week is on disk, nothing runs again
  const again = recorder();
  clock.now = at("2026-10-26T09:00:00Z");
  const r2 = serve({ slugs: [slug], dailyEveryS: 0, reportEveryS: 3600, eventsCheckEveryS: 0.02, port: 0, spawnImpl: again.spawnImpl, log: quiet, now: () => clock.now });
  await r2.boot;
  await sleep(80);
  await r2.stop();
  assert.deepEqual(again.events(), []);
});

test("serve: not before 07:00 — the job fires on the first check after the time", async () => {
  const slug = scheduledTenant("evearly");
  const rec = recorder();
  const clock = { now: at("2026-10-26T05:30:00Z") }; // 06:30 in Rome
  const r = serve({ slugs: [slug], dailyEveryS: 0, reportEveryS: 3600, eventsCheckEveryS: 0.02, port: 0, spawnImpl: rec.spawnImpl, log: quiet, now: () => clock.now });
  await r.boot;
  await sleep(80);
  assert.deepEqual(rec.events(), []);
  assert.equal(r.state[slug].events.next, "2026-10-26T06:00:00.000Z");
  clock.now = at("2026-10-26T06:00:30Z");
  await sleep(120);
  await r.stop();
  assert.equal(rec.events().length, 1);
});

test("serve: no catch-up on Tuesday; --no-events never schedules it", async () => {
  const slug = scheduledTenant("evtue");
  const rec = recorder();
  const r = serve({ slugs: [slug], dailyEveryS: 0, reportEveryS: 3600, eventsCheckEveryS: 0.02, port: 0, spawnImpl: rec.spawnImpl, log: quiet, now: () => at("2026-10-27T08:00:00Z") });
  await r.boot;
  await sleep(80);
  await r.stop();
  assert.deepEqual(rec.events(), []);
  assert.equal(r.state[slug].events.next, "2026-11-02T06:00:00.000Z");
  assert.deepEqual(readEventsState(slug), {});

  const off = recorder();
  const slug2 = scheduledTenant("evoff");
  const r2 = serve({ slugs: [slug2], dailyEveryS: 0, reportEveryS: 3600, events: false, eventsCheckEveryS: 0.02, port: 0, spawnImpl: off.spawnImpl, log: quiet, now: () => at("2026-10-26T07:30:00Z") });
  await r2.boot;
  await sleep(80);
  await r2.stop();
  assert.deepEqual(off.events(), []);
  assert.equal(r2.state[slug2].events, undefined);
});

test("serve: a skipped week (exit 3) is not an error; the job waits for the tenant's daily run", async () => {
  const slug = scheduledTenant("evskip");
  let releaseDaily;
  const order = [];
  const spawnImpl = async ({ cmd }) => {
    order.push(`${cmd}:start`);
    if (cmd === "daily") await new Promise((r) => { releaseDaily = r; });
    order.push(`${cmd}:end`);
    return cmd === "events" ? { ok: false, code: 3, stdout: "⏭️ solo 2 eventi", stderr: "" } : { ok: true, code: 0, stdout: "", stderr: "" };
  };
  const r = serve({ slugs: [slug], dailyEveryS: 3600, reportEveryS: 3600, eventsCheckEveryS: 0.02, port: 0, spawnImpl, log: quiet, now: () => at("2026-10-26T07:30:00Z") });
  await sleep(80);
  assert.ok(!order.includes("events:start"), "not while daily runs");
  releaseDaily();
  await r.boot;
  await sleep(120);
  await r.stop();
  assert.ok(order.indexOf("events:start") > order.indexOf("daily:end"));
  assert.equal(order.filter((x) => x === "events:start").length, 1);
  assert.equal(r.state[slug].events.error, null);
  assert.ok(r.state[slug].events.lastOk);
  assert.equal(readEventsState(slug).code, 3);
});

test("serve: a malformed schedule is reported, the other loops go on; GET /healthz shows the next run", async () => {
  const bad = scheduledTenant("evbad", { weekday: "someday", time: "07:00" });
  const good = scheduledTenant("evhealth");
  const rec = recorder();
  const r = serve({ slugs: [bad, good], dailyEveryS: 0, reportEveryS: 3600, eventsCheckEveryS: 3600, port: 18093, spawnImpl: rec.spawnImpl, log: quiet, now: () => at("2026-10-24T12:00:00Z") });
  await r.boot;
  try {
    const body = await (await fetch("http://127.0.0.1:18093/healthz")).json();
    assert.match(body.tenants.evbad.events.error, /weekday/);
    assert.equal(body.tenants.evhealth.events.next, "2026-10-26T06:00:00.000Z");
    assert.equal(body.tenants.evhealth.events.schedule, "mon 07:00 Europe/Rome");
    assert.deepEqual(rec.calls.map((c) => c.cmd).sort(), ["report", "report"]);
  } finally {
    await r.stop();
  }
});
