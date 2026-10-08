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
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadTenant } from "./config.mjs";

const CLI = fileURLToPath(new URL("../index.js", import.meta.url));

export const SERVER_DEFAULTS = { dailyEveryS: 1800, reportEveryS: 14400, port: 8080 };

/** The per-tenant key variable: tenant "my-brand" reads POSTPROXY_API_KEY_MY_BRAND. */
export function keyEnvFor(slug) {
  return `POSTPROXY_API_KEY_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

export function defaultSpawn({ slug, cmd, slugs }) {
  // per-tenant isolation: the global POSTPROXY_API_KEY never leaks to another tenant's child;
  // it passes through only when this process serves exactly that one tenant
  const env = { ...process.env };
  const own = process.env[keyEnvFor(slug)];
  delete env.POSTPROXY_API_KEY;
  if (own) env.POSTPROXY_API_KEY = own;
  else if (slugs.length === 1 && process.env.POSTPROXY_API_KEY) env.POSTPROXY_API_KEY = process.env.POSTPROXY_API_KEY;
  const child = spawn(process.execPath, [CLI, cmd, slug], { env });

  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  return new Promise((resolve) => {
    child.on("error", (e) => resolve({ ok: false, code: -1, stdout, stderr: String(e) }));
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

export function serve({ slugs, dailyEveryS = SERVER_DEFAULTS.dailyEveryS, reportEveryS = SERVER_DEFAULTS.reportEveryS, port = SERVER_DEFAULTS.port, once = false, spawnImpl = defaultSpawn, log = console.error, now = () => new Date() } = {}) {
  if (!slugs?.length) throw new Error("serve needs at least one tenant slug");
  const tenants = slugs.map(loadTenant);
  const state = Object.fromEntries(tenants.map((t) => [t.slug, {}]));
  const timers = [];
  const stamp = () => now().toISOString();

  async function runOnce(slug, kind) {
    const st = (state[slug][kind] ||= { runs: 0, lastOk: null, error: null, running: false });
    if (st.running) return (log(`serve: ${slug} ${kind} still running — skipping this tick`), null);
    st.running = true;
    st.runs += 1;
    log(`serve: ${slug} ${kind} → running`);
    try {
      const r = await Promise.resolve(spawnImpl({ slug, cmd: kind, slugs }));
      for (const line of (r.stdout || "").trim().split("\n").filter(Boolean)) log(`serve: ${slug} ${kind} | ${line}`);
      st.error = r.ok ? null : (r.stderr || "").trim().split("\n")[0] || `exit ${r.code}`;
      if (!r.ok) log(`serve: ${slug} ${kind} ✗ ${st.error}`);
      else st.lastOk = stamp();
      return { ...r, text: r.ok ? (r.stdout || "").trim() : null };
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
