/**
 * Remote render: ship a HyperFrames project to a faster machine on the tailnet over SSH, render it
 * there, bring the MP4 back and verify it. Optional and best-effort: every problem answers
 * { ok: false } and the caller renders locally, so an offline laptop never stops a round.
 *
 * The laptop runs ops/remote-render/ziggy-render-gate.sh as the forced command of a dedicated
 * key: `health` and `run <job> <quality> <version>` (gzip tar on stdin, MP4 on stdout) are the
 * only things that key can do.
 *
 * Config is read on every call (config.json → remoteRender, env overrides) so it can be switched
 * off without a restart; ZIGGY_REMOTE_RENDER=0 wins over everything. Health and slots are shared
 * across the parallel render processes through small files under <ZIGGY_HOME>/state/.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { loadConfig, ziggyHome } from "./config.mjs";

const OFF = /^(0|off|false|no)$/i;
const ON = /^(1|on|true|yes)$/i;
const HOST_RE = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9.:-]*$/;
const JOB_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const QUALITIES = new Set(["draft", "standard", "high"]);
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
const MIN_MP4_BYTES = 10 * 1024;
const HEALTHY_CACHE_MS = 60_000;

const PACK_EXT = new Set(["html", "htm", "css", "js", "mjs", "json", "md", "txt", "svg", "png", "jpg", "jpeg", "webp", "gif", "avif", "woff", "woff2", "ttf", "otf", "wav", "mp3", "m4a", "aac", "ogg", "mp4", "webm", "mov"]);
const AUDIO_EXT = new Set(["wav", "mp3", "m4a", "aac", "ogg"]);
const SKIP_DIRS = new Set(["renders", "snapshots", "node_modules"]);
const SECRETISH = /\.(env|pem|key)$|^id_|secret|token|credential/i;

const positive = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const nonNegative = (v, d) => (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

/** The effective remote-render settings for this call; `enabled` is false unless everything needed is there. */
export function remoteRenderConfig(env = process.env) {
  let rr = {};
  try { rr = loadConfig().remoteRender || {}; } catch { rr = {}; }
  const home = ziggyHome();
  const sw = String(env.ZIGGY_REMOTE_RENDER ?? "").trim();
  const host = String(env.ZIGGY_REMOTE_RENDER_HOST || rr.host || "").trim();
  const cfg = {
    host,
    key: env.ZIGGY_REMOTE_RENDER_KEY || rr.key || join(home, "ssh", "remote-render_ed25519"),
    knownHosts: rr.knownHosts || join(home, "ssh", "remote-render_known_hosts"),
    port: Math.floor(positive(rr.port, 22)),
    maxParallel: Math.max(1, Math.floor(positive(rr.maxParallel, 2))),
    connectTimeoutSec: positive(rr.connectTimeoutSec, 4),
    renderTimeoutSec: positive(rr.renderTimeoutSec, 600),
    minFreeGB: nonNegative(rr.minFreeGB, 10),
    slotWaitSec: nonNegative(rr.slotWaitSec, 240),
    downCacheSec: nonNegative(rr.downCacheSec, 120),
    ssh: env.ZIGGY_SSH_BIN || "ssh",
    tar: env.ZIGGY_TAR_BIN || "tar",
    ffprobe: env.ZIGGY_FFPROBE_BIN || "ffprobe",
    stateDir: join(home, "state"),
    enabled: false,
    reason: null,
  };
  const wanted = OFF.test(sw) ? false : ON.test(sw) ? true : rr.enabled === true;
  if (!wanted || !host) cfg.reason = "disabled";
  else if (!HOST_RE.test(host)) cfg.reason = "bad host";
  else if (!existsSync(cfg.key)) cfg.reason = "no ssh key";
  else cfg.enabled = true;
  return cfg;
}

export function sshArgs(cfg) {
  return [
    "-i", cfg.key, "-p", String(cfg.port),
    "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${cfg.knownHosts}`,
    "-o", `ConnectTimeout=${cfg.connectTimeoutSec}`,
    "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
    "-o", "LogLevel=ERROR",
    "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes",
    cfg.host,
  ];
}

/* ── health, cached across processes ─────────────────────────────────────── */

const healthFile = (cfg) => join(cfg.stateDir, "remote-render-health.json");

function readHealth(cfg) {
  try {
    const h = JSON.parse(readFileSync(healthFile(cfg), "utf8"));
    return h && h.host === cfg.host && Date.now() < h.until ? h : null;
  } catch { return null; }
}

function writeHealth(cfg, ok, ttlMs, reason = null) {
  try {
    mkdirSync(cfg.stateDir, { recursive: true });
    const file = healthFile(cfg), tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ host: cfg.host, ok, reason, at: new Date().toISOString(), until: Date.now() + ttlMs }) + "\n");
    renameSync(tmp, file);
  } catch { /* a cache, not a requirement */ }
}

function markDown(cfg, reason) {
  writeHealth(cfg, false, cfg.downCacheSec * 1000, reason);
}

/** ok | reason; a fresh probe only when the cache has no answer for this host. */
function health(cfg) {
  const cached = readHealth(cfg);
  if (cached) return cached.ok ? { ok: true } : { ok: false, reason: `laptop down (${cached.reason || "cached"})`, cached: true };
  const r = spawnSync(cfg.ssh, [...sshArgs(cfg), "health"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: (cfg.connectTimeoutSec + 4) * 1000, killSignal: "SIGKILL" });
  let reason = null;
  const m = (r.stdout || "").match(/^ok free_kb=(\d+) jobs=(\d+) hf=([01])\s*$/m);
  if (r.error) reason = r.error.code === "ETIMEDOUT" ? "health timed out" : `ssh ${r.error.code || r.error.message}`;
  else if (r.status !== 0) reason = `health exit ${r.status ?? r.signal}`;
  else if (!m) reason = "bad health answer";
  else if (Number(m[1]) < cfg.minFreeGB * 1024 * 1024) reason = `laptop has ${(Number(m[1]) / 1024 / 1024).toFixed(1)} GB free`;
  else if (m[3] !== "1") reason = "no npx on the laptop";
  if (reason) { markDown(cfg, reason); return { ok: false, reason }; }
  writeHealth(cfg, true, HEALTHY_CACHE_MS);
  return { ok: true };
}

/* ── slots: a cross-process semaphore of mkdir'd directories ─────────────── */

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

function slotIsStale(slot, cfg) {
  const maxAge = (cfg.renderTimeoutSec + 120) * 1000;
  try {
    const owner = JSON.parse(readFileSync(join(slot, "owner.json"), "utf8"));
    return !Number.isInteger(owner.pid) || !alive(owner.pid) || Date.now() - Number(owner.at) > maxAge;
  } catch {
    // no owner yet: someone is between mkdir and writing owner.json, unless it has been a while
    try { return Date.now() - statSync(slot).mtimeMs > 30_000; } catch { return false; }
  }
}

function tryTake(slot) {
  try { mkdirSync(slot); } catch { return null; }
  const owner = { pid: process.pid, at: Date.now() };
  writeFileSync(join(slot, "owner.json"), JSON.stringify(owner));
  return { slot, owner };
}

function acquireSlot(cfg) {
  const dir = join(cfg.stateDir, "remote-render-slots");
  mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + cfg.slotWaitSec * 1000;
  for (;;) {
    for (let i = 0; i < cfg.maxParallel; i++) {
      const slot = join(dir, `slot-${i}`);
      let held = tryTake(slot);
      if (!held && slotIsStale(slot, cfg)) {
        rmSync(slot, { recursive: true, force: true });
        held = tryTake(slot);
      }
      if (held) return held;
    }
    const left = deadline - Date.now();
    if (left <= 0) return null;
    sleepSync(Math.min(2000, left));
  }
}

function releaseSlot(held) {
  try {
    const owner = JSON.parse(readFileSync(join(held.slot, "owner.json"), "utf8"));
    if (owner.pid !== held.owner.pid || owner.at !== held.owner.at) return;
  } catch { return; }
  rmSync(held.slot, { recursive: true, force: true });
}

/* ── pack ────────────────────────────────────────────────────────────────── */

/** What may leave the machine: an allowlist of render inputs, never dotfiles, renders or anything key-like. */
export function projectFiles(projectDir) {
  const out = [];
  const seen = new Set();
  const walk = (abs, rel) => {
    const st = statSync(abs);
    const id = `${st.dev}:${st.ino}`;
    if (seen.has(id)) return;
    seen.add(id);
    for (const name of readdirSync(abs).sort()) {
      if (name.startsWith(".") || SECRETISH.test(name) || /[\r\n]/.test(name)) continue;
      const path = join(abs, name), relPath = rel ? `${rel}/${name}` : name;
      let s;
      try { s = statSync(path); } catch { continue; }
      if (s.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(path, relPath); }
      else if (s.isFile() && PACK_EXT.has(extname(name).slice(1).toLowerCase())) out.push(relPath);
    }
  };
  walk(projectDir, "");
  return out;
}

function pack(cfg, projectDir, files, tmpBase) {
  const list = `${tmpBase}.list`, tgz = `${tmpBase}.tgz`;
  // "./" keeps a name that starts with "-" from reading as a tar option
  writeFileSync(list, files.map((f) => `./${f}`).join("\n") + "\n");
  const r = spawnSync(cfg.tar, ["-czhf", tgz, "-C", projectDir, "-T", list], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: 120_000, killSignal: "SIGKILL" });
  if (r.error || r.status !== 0) throw new Error(`pack failed (${r.error?.code || (r.stderr || "").trim().split("\n").pop() || `exit ${r.status}`})`);
  const size = statSync(tgz).size;
  if (size > MAX_ARCHIVE_BYTES) throw new Error(`project is ${Math.round(size / 1024 / 1024)} MB packed`);
  return tgz;
}

/* ── verify ──────────────────────────────────────────────────────────────── */

/** An MP4 worth keeping: real size, probes, has video, has the length the project asks for, has sound if it should. */
export function verifyMp4(file, { expectedSeconds = null, needAudio = false, ffprobe = process.env.ZIGGY_FFPROBE_BIN || "ffprobe" } = {}) {
  let size = 0;
  try { size = statSync(file).size; } catch { return { ok: false, reason: "no file" }; }
  if (size <= MIN_MP4_BYTES) return { ok: false, reason: `only ${size} bytes` };
  const r = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
  if (r.error || r.status !== 0) return { ok: false, reason: `ffprobe failed (${r.error?.code || (r.stderr || "").trim().split("\n").pop() || `exit ${r.status}`})` };
  let info;
  try { info = JSON.parse(r.stdout); } catch { return { ok: false, reason: "ffprobe output unreadable" }; }
  const types = (info.streams || []).map((s) => s.codec_type);
  const duration = Number(info.format?.duration);
  if (!types.includes("video")) return { ok: false, reason: "no video stream" };
  if (!(duration > 0)) return { ok: false, reason: "no duration" };
  if (expectedSeconds != null && Math.abs(duration - expectedSeconds) > 1.0) return { ok: false, reason: `duration ${duration.toFixed(2)}s, expected ${expectedSeconds}s` };
  if (needAudio && !types.includes("audio")) return { ok: false, reason: "no audio stream" };
  return { ok: true, duration, streams: types };
}

function expectedDuration(projectDir) {
  try {
    const m = readFileSync(join(projectDir, "index.html"), "utf8").match(/data-duration="([0-9]+(?:\.[0-9]+)?)"/);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

/* ── render ──────────────────────────────────────────────────────────────── */

const logFile = (cfg) => join(cfg.stateDir, "remote-render.log.jsonl");

function record(cfg, entry) {
  try {
    mkdirSync(cfg.stateDir, { recursive: true });
    appendFileSync(logFile(cfg), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch { /* the log never decides a render */ }
}

let offWarned = false;

function jobName(projectDir) {
  const base = basename(projectDir).replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "job";
  return `${base}-${process.pid}-${Date.now()}`.slice(-120).replace(/^[^A-Za-z0-9]+/, "");
}

function unlinkQuiet(...files) {
  for (const f of files) if (f) rmSync(f, { force: true });
}

/**
 * Try the remote machine. Never throws: { ok: true, output, seconds, host } or { ok: false, reason }.
 * Synchronous on purpose, like the local render it stands in for.
 */
export function remoteRender(projectDir, { output, quality = "high", version, log = () => {} } = {}) {
  const say = (s) => { try { log(s); } catch { /* a log line never decides a render */ } };
  let cfg;
  try { cfg = remoteRenderConfig(); } catch (error) { return { ok: false, reason: `config: ${error.message}` }; }
  if (!cfg.enabled) {
    if (cfg.reason !== "disabled" && !offWarned) {
      offWarned = true;
      say(`  remote render off (${cfg.reason === "no ssh key" ? `no ssh key at ${cfg.key}` : cfg.reason})`);
    }
    return { ok: false, reason: cfg.reason };
  }
  const project = basename(projectDir);
  const started = Date.now();
  const fail = (reason, { quiet = false } = {}) => {
    if (!quiet) say(`  remote render failed (${reason}) — rendering locally`);
    record(cfg, { project, host: cfg.host, ok: false, seconds: Math.round((Date.now() - started) / 100) / 10, reason });
    return { ok: false, reason };
  };
  try {
    if (!output) return fail("no output path");
    if (!QUALITIES.has(quality)) return fail(`quality ${JSON.stringify(quality)}`);
    if (!VERSION_RE.test(String(version || ""))) return fail(`hyperframes version ${JSON.stringify(version)}`);

    const h = health(cfg);
    if (!h.ok) {
      if (!h.cached) say(`  remote render unavailable (${h.reason}) — rendering locally`);
      return fail(h.reason, { quiet: true });
    }

    const held = acquireSlot(cfg);
    if (!held) return fail("no free remote slot");
    const job = jobName(projectDir);
    const outDir = dirname(output);
    const tmpBase = join(outDir, `.remote-${job}`);
    const part = `${tmpBase}.mp4.part`;
    let tgz = null;
    try {
      if (!JOB_RE.test(job)) return fail(`job name ${JSON.stringify(job)}`);
      mkdirSync(outDir, { recursive: true });
      const files = projectFiles(projectDir);
      if (!files.includes("index.html")) return fail("project has no index.html");
      tgz = pack(cfg, projectDir, files, tmpBase);

      const inFd = openSync(tgz, "r"), outFd = openSync(part, "w");
      let r;
      try {
        r = spawnSync(cfg.ssh, [...sshArgs(cfg), "run", job, quality, version], { stdio: [inFd, outFd, "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: cfg.renderTimeoutSec * 1000, killSignal: "SIGKILL" });
      } finally { closeSync(inFd); closeSync(outFd); }
      if (r.error) {
        if (r.error.code === "ETIMEDOUT") return fail(`timed out after ${cfg.renderTimeoutSec}s`);
        return fail(`ssh ${r.error.code || r.error.message}`);
      }
      if (r.status !== 0) {
        if (r.status === 255) markDown(cfg, "connection lost");
        const last = (r.stderr || "").trim().split("\n").filter(Boolean).pop();
        return fail(`exit ${r.status ?? r.signal}${last ? `: ${last.slice(0, 200)}` : ""}`);
      }

      const needAudio = files.some((f) => f.startsWith("assets/") && AUDIO_EXT.has(extname(f).slice(1).toLowerCase()));
      const v = verifyMp4(part, { expectedSeconds: expectedDuration(projectDir), needAudio, ffprobe: cfg.ffprobe });
      if (!v.ok) return fail(`verify failed: ${v.reason}`);

      renameSync(part, output);
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      say(`  rendered remotely on ${cfg.host} in ${seconds}s`);
      record(cfg, { project, host: cfg.host, ok: true, seconds, reason: null });
      return { ok: true, output, seconds, host: cfg.host };
    } finally {
      unlinkQuiet(`${tmpBase}.list`, tgz || `${tmpBase}.tgz`, part);
      releaseSlot(held);
    }
  } catch (error) {
    return fail(error.message.split("\n")[0]);
  }
}
