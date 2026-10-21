import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, beforeEach, test } from "node:test";

import { projectFiles, remoteRenderConfig, verifyMp4 } from "../scripts/remote.mjs";
import { render } from "../scripts/video.mjs";
import { makeWorld } from "./helpers.mjs";

const world = makeWorld({ withRenders: false, withCampaign: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;

const GATE = join(import.meta.dirname, "..", "..", "ops", "remote-render", "ziggy-render-gate.sh");
const HAS_BASH = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const REMOTE_MP4 = Buffer.concat([Buffer.from("REMOTE-MP4"), Buffer.alloc(20_000, 7)]);

const bins = join(world.root, "fakebin-remote");
mkdirSync(bins, { recursive: true });
const write = (name, body) => { writeFileSync(join(bins, name), body); chmodSync(join(bins, name), 0o755); return join(bins, name); };

// local renderer: records every call, writes a tiny "mp4"
const HF = write("hyperframes", `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const [cmd, ...rest] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(bins, "hf.log"))}, process.argv.slice(2).join(" ") + "\\n");
if (cmd === "render") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, "local-mp4"); process.exit(0); }
process.exit(1);
`);

// ssh: FAKE_SSH_MODE=ok | down (255 on everything) | runfail (render error) | drop (255 during run)
const SSH = write("ssh", `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(bins, "ssh.log"))}, JSON.stringify(args) + "\\n");
const mode = process.env.FAKE_SSH_MODE || "ok";
if (mode === "down") { process.stderr.write("ssh: connect to host 100.64.0.1 port 22: Connection refused\\n"); process.exit(255); }
if (args[args.length - 1] === "health") { console.log("ok free_kb=" + (process.env.FAKE_FREE_KB || "99999999") + " jobs=0 hf=1"); process.exit(0); }
if (args[args.length - 4] === "run") {
  fs.writeFileSync(${JSON.stringify(join(bins, "last.tgz"))}, fs.readFileSync(0));
  if (mode === "runfail") { process.stderr.write("render failed (exit 1)\\n"); process.exit(1); }
  if (mode === "drop") { process.stderr.write("Connection to 100.64.0.1 closed by remote host.\\n"); process.exit(255); }
  fs.writeSync(1, Buffer.concat([Buffer.from("REMOTE-MP4"), Buffer.alloc(20000, 7)]));
  process.exit(0);
}
process.stderr.write("denied\\n"); process.exit(2);
`);

const FFPROBE = write("ffprobe", `#!/usr/bin/env node
const streams = [{ codec_type: "video" }];
if (process.env.FAKE_AUDIO !== "none") streams.push({ codec_type: "audio" });
console.log(JSON.stringify({ streams, format: { duration: process.env.FAKE_DURATION || "7.5" } }));
`);

const KEY = join(world.home, "ssh", "remote-render_ed25519");
mkdirSync(dirname(KEY), { recursive: true });
writeFileSync(KEY, "placeholder, never read by the fake ssh\n");

const project = join(world.root, "videos", "story-reel");
const outDir = join(world.root, "renders");
const output = join(outDir, "acme-story-reel-1080x1920.mp4");

function buildProject(dir) {
  for (const d of ["compositions", "assets/fonts", "renders", "snapshots/final", "node_modules/evil", ".git", "keys"]) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, "index.html"), `<div id="host" data-composition-id="host" data-start="0" data-width="1080" data-height="1920" data-duration="7.5"></div>`);
  writeFileSync(join(dir, "compositions", "story-reel.html"), "<div></div>");
  writeFileSync(join(dir, "hyperframes.json"), "{}");
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "meta.json"), "{}");
  writeFileSync(join(dir, "BRIEF.md"), "brief");
  writeFileSync(join(dir, "assets", "fonts", "Geist.woff2"), Buffer.alloc(64));
  writeFileSync(join(dir, "assets", "story.jpg"), Buffer.alloc(64));
  writeFileSync(join(dir, "assets", "bed.wav"), Buffer.alloc(64));
  writeFileSync(join(dir, "renders", "old.mp4"), "old");
  writeFileSync(join(dir, "snapshots", "final", "frame-00.png"), "png");
  writeFileSync(join(dir, "node_modules", "evil", "index.js"), "evil");
  writeFileSync(join(dir, ".git", "config"), "git");
  writeFileSync(join(dir, ".env"), "POSTPROXY_API_KEY=nope");
  writeFileSync(join(dir, "id_rsa"), "key");
  writeFileSync(join(dir, "server.pem"), "pem");
  writeFileSync(join(dir, "api-token.txt"), "token");
  writeFileSync(join(dir, "keys", "deploy.key"), "key");
  writeFileSync(join(dir, "notes.xyz"), "not on the allowlist");
}
buildProject(project);
// a symlinked asset directory is followed (tar -h ships the files, not the link)
const shared = join(world.root, "shared-assets");
mkdirSync(shared, { recursive: true });
writeFileSync(join(shared, "poster-01.png"), Buffer.alloc(64));
symlinkSync(shared, join(project, "assets", "shared"));

const ENABLED = { enabled: true, host: "tester@100.64.0.1", slotWaitSec: 1, downCacheSec: 120 };
const writeConfig = (remoteRender) => writeFileSync(join(world.home, "config.json"), JSON.stringify({ version: 1, ...(remoteRender ? { remoteRender } : {}) }));
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);
const sshCalls = () => lines(join(bins, "ssh.log")).map((l) => JSON.parse(l));
const hfCalls = () => lines(join(bins, "hf.log"));
const leftovers = () => (existsSync(outDir) ? readdirSync(outDir).filter((f) => f.startsWith(".remote-")) : []);
const attempts = () => lines(join(world.home, "state", "remote-render.log.jsonl")).map((l) => JSON.parse(l));

const ENV_KEYS = ["ZIGGY_REMOTE_RENDER", "ZIGGY_REMOTE_RENDER_HOST", "ZIGGY_REMOTE_RENDER_KEY", "FAKE_SSH_MODE", "FAKE_DURATION", "FAKE_AUDIO", "FAKE_FREE_KB"];
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { ZIGGY_SSH_BIN: SSH, ZIGGY_FFPROBE_BIN: FFPROBE, ZIGGY_HYPERFRAMES_BIN: HF });
  for (const f of ["ssh.log", "hf.log", "last.tgz"]) rmSync(join(bins, f), { force: true });
  rmSync(join(world.home, "state"), { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
  writeConfig(ENABLED);
});
after(() => { for (const k of [...ENV_KEYS, "ZIGGY_SSH_BIN", "ZIGGY_FFPROBE_BIN", "ZIGGY_HYPERFRAMES_BIN"]) delete process.env[k]; });

const renderNow = () => {
  const log = [];
  const result = render(project, { output, quality: "high", log: (s) => log.push(s) });
  return { result, log };
};

test("config: off by default, kill switch wins, no key means off", () => {
  writeConfig(null);
  assert.equal(remoteRenderConfig().enabled, false);
  writeConfig({ enabled: true });
  assert.equal(remoteRenderConfig().reason, "disabled", "no host, no remote");
  writeConfig(ENABLED);
  const cfg = remoteRenderConfig();
  assert.equal(cfg.enabled, true);
  assert.deepEqual([cfg.port, cfg.maxParallel, cfg.connectTimeoutSec, cfg.renderTimeoutSec, cfg.minFreeGB], [22, 2, 4, 600, 10]);
  assert.equal(cfg.key, KEY);
  assert.equal(cfg.knownHosts, join(world.home, "ssh", "remote-render_known_hosts"));
  assert.equal(remoteRenderConfig({ ...process.env, ZIGGY_REMOTE_RENDER: "0" }).enabled, false);
  assert.equal(remoteRenderConfig({ ...process.env, ZIGGY_REMOTE_RENDER: "off" }).enabled, false);
  writeConfig(null);
  assert.equal(remoteRenderConfig({ ...process.env, ZIGGY_REMOTE_RENDER: "1" }).enabled, false, "forced on still needs a host");
  assert.equal(remoteRenderConfig({ ...process.env, ZIGGY_REMOTE_RENDER: "1", ZIGGY_REMOTE_RENDER_HOST: "u@100.64.0.2" }).enabled, true);
  assert.equal(remoteRenderConfig({ ...process.env, ZIGGY_REMOTE_RENDER: "1", ZIGGY_REMOTE_RENDER_HOST: "-oProxyCommand=x" }).enabled, false);
  const noKey = remoteRenderConfig({ ...process.env, ZIGGY_REMOTE_RENDER: "1", ZIGGY_REMOTE_RENDER_HOST: "u@100.64.0.2", ZIGGY_REMOTE_RENDER_KEY: join(world.root, "missing") });
  assert.deepEqual([noKey.enabled, noKey.reason], [false, "no ssh key"]);
});

test("disabled by default and with the kill switch: render() stays local and never calls ssh", () => {
  writeConfig(null);
  let { result } = renderNow();
  assert.equal(result.remote, undefined);
  assert.equal(readFileSync(output, "utf8"), "local-mp4");

  writeConfig(ENABLED);
  process.env.ZIGGY_REMOTE_RENDER = "0";
  ({ result } = renderNow());
  assert.equal(result.remote, undefined);
  assert.equal(sshCalls().length, 0);
  assert.equal(hfCalls().length, 2);
  assert.match(hfCalls()[0], /^render \. --skill=motion-graphics -q high -o /);
  assert.equal(attempts().length, 0, "a disabled remote leaves no trace");
});

test("enabled and healthy: the laptop renders, the MP4 is verified and moved into place, no local render", () => {
  const { result, log } = renderNow();
  assert.deepEqual(result, { output, log: "remote", remote: true });
  assert.ok(readFileSync(output).equals(REMOTE_MP4));
  assert.equal(hfCalls().length, 0);
  assert.match(log.join("\n"), /rendered remotely on tester@100\.64\.0\.1 in [\d.]+s/);

  const calls = sshCalls();
  assert.equal(calls.length, 2);
  const [health, run] = calls;
  assert.equal(health.at(-1), "health");
  assert.equal(health.at(-2), "tester@100.64.0.1");
  for (const opt of ["BatchMode=yes", "IdentitiesOnly=yes", "StrictHostKeyChecking=yes", `UserKnownHostsFile=${join(world.home, "ssh", "remote-render_known_hosts")}`, "ConnectTimeout=4", "ServerAliveInterval=10", "ServerAliveCountMax=3", "LogLevel=ERROR"]) {
    assert.ok(health.includes(opt), opt);
  }
  assert.deepEqual(health.slice(0, 4), ["-i", KEY, "-p", "22"]);
  assert.ok(!health.includes("-A"));
  assert.deepEqual(run.slice(-2), ["high", "0.8.133"]);
  assert.equal(run.at(-4), "run");
  assert.match(run.at(-3), /^story-reel-\d+-\d+$/);
  assert.match(run.at(-3), /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/);

  const shipped = spawnSync("tar", ["-tzf", join(bins, "last.tgz")], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const f of ["./index.html", "./compositions/story-reel.html", "./assets/bed.wav", "./assets/fonts/Geist.woff2", "./assets/shared/poster-01.png"]) assert.ok(shipped.includes(f), f);
  assert.ok(!shipped.some((f) => /\.env|id_rsa|\.pem|token|renders|snapshots|node_modules|\.git/.test(f)), shipped.join(" "));

  assert.deepEqual(leftovers(), []);
  assert.deepEqual(readdirSync(join(world.home, "state", "remote-render-slots")), [], "the slot is released");
  const [entry] = attempts();
  assert.deepEqual([entry.project, entry.host, entry.ok, entry.reason], ["story-reel", "tester@100.64.0.1", true, null]);
  assert.equal(typeof entry.seconds, "number");
});

test("unreachable laptop: local fallback, and the next render skips ssh while the host is marked down", () => {
  process.env.FAKE_SSH_MODE = "down";
  const first = renderNow();
  assert.equal(first.result.remote, undefined);
  assert.equal(readFileSync(output, "utf8"), "local-mp4");
  assert.equal(sshCalls().length, 1);
  assert.match(first.log.join("\n"), /remote render unavailable \(health exit 255\) — rendering locally/);
  const healthFile = JSON.parse(readFileSync(join(world.home, "state", "remote-render-health.json"), "utf8"));
  assert.equal(healthFile.ok, false);
  assert.ok(healthFile.until > Date.now() + 100_000);

  const second = renderNow();
  assert.equal(second.result.remote, undefined);
  assert.equal(sshCalls().length, 1, "no second ssh within downCacheSec");
  assert.equal(hfCalls().length, 2);
  assert.deepEqual(attempts().map((a) => a.ok), [false, false]);
});

test("low disk or no npx on the laptop counts as down", () => {
  process.env.FAKE_FREE_KB = String(2 * 1024 * 1024);
  const { result, log } = renderNow();
  assert.equal(result.remote, undefined);
  assert.match(log.join("\n"), /laptop has 2\.0 GB free/);
  assert.equal(sshCalls().length, 1);
});

test("remote render fails: local fallback, no leftover temp files; a dropped connection marks the host down", () => {
  process.env.FAKE_SSH_MODE = "runfail";
  let { result, log } = renderNow();
  assert.equal(result.remote, undefined);
  assert.equal(readFileSync(output, "utf8"), "local-mp4");
  assert.match(log.join("\n"), /remote render failed \(exit 1: render failed \(exit 1\)\) — rendering locally/);
  assert.deepEqual(leftovers(), []);
  assert.deepEqual(readdirSync(join(world.home, "state", "remote-render-slots")), []);

  rmSync(join(world.home, "state"), { recursive: true, force: true });
  rmSync(join(bins, "ssh.log"), { force: true });
  process.env.FAKE_SSH_MODE = "drop";
  ({ result } = renderNow());
  assert.equal(result.remote, undefined);
  assert.deepEqual(leftovers(), []);
  assert.equal(JSON.parse(readFileSync(join(world.home, "state", "remote-render-health.json"), "utf8")).ok, false);
  delete process.env.FAKE_SSH_MODE;
  renderNow();
  assert.equal(sshCalls().length, 2, "health + run, then nothing while the host is down");
});

test("verify fails (duration mismatch, missing audio): local fallback, no .part left behind", () => {
  process.env.FAKE_DURATION = "12";
  let { result, log } = renderNow();
  assert.equal(result.remote, undefined);
  assert.equal(readFileSync(output, "utf8"), "local-mp4");
  assert.match(log.join("\n"), /remote render failed \(verify failed: duration 12\.00s, expected 7\.5s\) — rendering locally/);
  assert.deepEqual(leftovers(), []);

  delete process.env.FAKE_DURATION;
  process.env.FAKE_AUDIO = "none";
  ({ result, log } = renderNow());
  assert.equal(result.remote, undefined);
  assert.match(log.join("\n"), /verify failed: no audio stream/);
  assert.deepEqual(leftovers(), []);
  assert.equal(hfCalls().length, 2);
});

test("verifyMp4: size, probe, video stream, duration", () => {
  const small = join(world.root, "small.mp4"), big = join(world.root, "big.mp4");
  writeFileSync(small, Buffer.alloc(100));
  writeFileSync(big, REMOTE_MP4);
  assert.match(verifyMp4(small, { ffprobe: FFPROBE }).reason, /only 100 bytes/);
  assert.equal(verifyMp4(big, { ffprobe: FFPROBE, expectedSeconds: 7 }).ok, true);
  assert.match(verifyMp4(big, { ffprobe: FFPROBE, expectedSeconds: 9 }).reason, /duration/);
  assert.match(verifyMp4(big, { ffprobe: join(world.root, "no-ffprobe") }).reason, /ffprobe failed/);
});

test("projectFiles: render inputs only — no dotfiles, renders, snapshots, node_modules or key-like names", () => {
  const files = projectFiles(project);
  for (const f of ["index.html", "compositions/story-reel.html", "hyperframes.json", "package.json", "meta.json", "BRIEF.md", "assets/fonts/Geist.woff2", "assets/story.jpg", "assets/bed.wav", "assets/shared/poster-01.png"]) {
    assert.ok(files.includes(f), f);
  }
  for (const f of files) assert.doesNotMatch(f, /^\.|\/\.|^renders\/|^snapshots\/|node_modules|id_rsa|\.pem$|\.key$|token|\.xyz$/, f);
  assert.ok(!files.includes(".env"));
});

test("slots: a live foreign owner makes the render wait, then go local; a dead owner's slot is reclaimed", () => {
  writeConfig({ ...ENABLED, maxParallel: 1, slotWaitSec: 1 });
  const slot = join(world.home, "state", "remote-render-slots", "slot-0");
  mkdirSync(slot, { recursive: true });
  writeFileSync(join(slot, "owner.json"), JSON.stringify({ pid: process.ppid, at: Date.now() }));
  const t0 = Date.now();
  let { result, log } = renderNow();
  assert.ok(Date.now() - t0 >= 900, "waited for the slot");
  assert.equal(result.remote, undefined);
  assert.match(log.join("\n"), /remote render failed \(no free remote slot\) — rendering locally/);
  assert.deepEqual(sshCalls().map((c) => c.at(-1)), ["health"]);
  assert.ok(existsSync(join(slot, "owner.json")), "someone else's slot is left alone");

  const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
  writeFileSync(join(slot, "owner.json"), JSON.stringify({ pid: dead, at: Date.now() }));
  ({ result } = renderNow());
  assert.equal(result.remote, true);
  assert.ok(!existsSync(slot), "reclaimed, then released");

  mkdirSync(slot, { recursive: true });
  writeFileSync(join(slot, "owner.json"), JSON.stringify({ pid: process.ppid, at: Date.now() - 3600_000 }));
  ({ result } = renderNow());
  assert.equal(result.remote, true, "an owner older than renderTimeoutSec + 120 s is stale");
});

/* ── the laptop-side gate ─────────────────────────────────────────────────── */

const gateHome = join(world.root, "gate-home");
const gateBin = join(world.root, "gate-bin");
const gatePath = `${gateBin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`;
if (HAS_BASH) {
  mkdirSync(gateHome, { recursive: true });
  mkdirSync(gateBin, { recursive: true });
  writeFileSync(join(gateBin, "npx"), `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(join(world.root, "npx.log"))}, JSON.stringify({ args, cwd: process.cwd(), files: fs.readdirSync(".").sort() }));
console.log("rendering… (this line must not reach stdout)");
fs.writeFileSync(path.resolve(args[args.indexOf("-o") + 1]), Buffer.concat([Buffer.from("GATE-MP4"), Buffer.alloc(15000, 3)]));
`);
  chmodSync(join(gateBin, "npx"), 0o755);
}
const gate = (command, { input, env = {} } = {}) => spawnSync("bash", [GATE], {
  input, env: { HOME: gateHome, PATH: gatePath, ZIGGY_GATE_PATH: gatePath, SSH_ORIGINAL_COMMAND: command, ...env },
});

test("gate: health answers ok with free space, job count and npx", { skip: !HAS_BASH && "no bash" }, () => {
  const r = gate("health");
  assert.equal(r.status, 0, String(r.stderr));
  assert.match(String(r.stdout), /^ok free_kb=\d+ jobs=0 hf=1\n$/);
  const noNpx = gate("health", { env: { ZIGGY_GATE_PATH: "/usr/bin:/bin" } });
  assert.match(String(noNpx.stdout), /hf=0/);
});

test("gate: anything but health/run is denied with exit 2", { skip: !HAS_BASH && "no bash" }, () => {
  for (const cmd of ["", "ls", "health now", "sh -c id", "run", "run ../escape high 0.8.133", "run .hidden high 0.8.133", "run job1 ultra 0.8.133", "run job1 high latest", "run job1 high 0.8.133 extra", "run job1 high 0.8.133;id"]) {
    const r = gate(cmd);
    assert.equal(r.status, 2, `${JSON.stringify(cmd)} → ${r.status}`);
    assert.match(String(r.stderr), /denied/);
    assert.equal(r.stdout.length, 0);
  }
  assert.ok(!existsSync(join(gateHome, "ziggy-render", "jobs", "..", "escape")));
});

test("gate: run extracts the project, renders with the pinned CLI, streams only the MP4 and removes the job", { skip: !HAS_BASH && "no bash" }, () => {
  const tgz = spawnSync("tar", ["-czf", "-", "-C", project, "index.html", "compositions", "assets/bed.wav", ".env", "node_modules"]).stdout;
  const r = gate("run job-1 standard 0.8.133", { input: tgz });
  assert.equal(r.status, 0, String(r.stderr));
  assert.ok(r.stdout.subarray(0, 8).equals(Buffer.from("GATE-MP4")), "stdout is the MP4 and nothing else");
  assert.equal(r.stdout.length, 8 + 15000);
  assert.match(String(r.stderr), /this line must not reach stdout/);
  const call = JSON.parse(readFileSync(join(world.root, "npx.log"), "utf8"));
  assert.deepEqual(call.args, ["--yes", "hyperframes@0.8.133", "render", ".", "--skill=motion-graphics", "-q", "standard", "-o", "../out.mp4"]);
  assert.match(call.cwd, /ziggy-render\/jobs\/job-1\/project$/);
  assert.deepEqual(call.files, ["assets", "compositions", "index.html"], "dotfiles and node_modules are dropped before rendering");
  assert.deepEqual(readdirSync(join(gateHome, "ziggy-render", "jobs")), []);

  const broken = gate("run job-2 high 0.8.133", { input: Buffer.from("not a tarball") });
  assert.notEqual(broken.status, 0);
  assert.equal(broken.stdout.length, 0);
  assert.deepEqual(readdirSync(join(gateHome, "ziggy-render", "jobs")), []);
});

test("gate: the watchdog stops a render that runs too long", { skip: !HAS_BASH && "no bash" }, () => {
  const slowBin = join(world.root, "gate-slow");
  mkdirSync(slowBin, { recursive: true });
  writeFileSync(join(slowBin, "npx"), "#!/bin/sh\nsleep 30\n");
  chmodSync(join(slowBin, "npx"), 0o755);
  const slowPath = `${slowBin}:/usr/bin:/bin`;
  const tgz = spawnSync("tar", ["-czf", "-", "-C", project, "index.html"]).stdout;
  const t0 = Date.now();
  const r = gate("run job-slow high 0.8.133", { input: tgz, env: { PATH: slowPath, ZIGGY_GATE_PATH: slowPath, ZIGGY_GATE_TIMEOUT: "1" } });
  assert.ok(Date.now() - t0 < 15_000);
  assert.notEqual(r.status, 0);
  assert.match(String(r.stderr), /timed out after 1s/);
  assert.equal(r.stdout.length, 0);
  assert.deepEqual(readdirSync(join(gateHome, "ziggy-render", "jobs")), []);
});
