import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { agentAvailable, DEFAULT_STORY_AGENT, storyAgent } from "../scripts/story.mjs";
import { makeWorld } from "./helpers.mjs";

const world = makeWorld();
process.env.ZIGGY_HOME = world.home;
const writeConfig = (config) => writeFileSync(join(world.home, "config.json"), JSON.stringify(config));

const SSH = ["ssh", "-i", "/data/ssh/story-agent_ed25519", "zencrust@host.docker.internal", "claude-json"];
const ENV_CMD = ["/usr/local/bin/agent", "--json"];
const tenant = (agent) => ({ slug: "acme", feed: { url: "https://acme.example/feed", ...(agent === undefined ? {} : { agent }) } });

test("storyAgent: tenant command > env > config.json > default; tenant null/false still disables", () => {
  writeConfig({ storyAgent: { command: SSH, timeoutMs: 180000 } });
  const env = { ZIGGY_STORY_AGENT_CMD: JSON.stringify(ENV_CMD), ZIGGY_STORY_AGENT_TIMEOUT_MS: "90000" };
  // a tenant command of its own wins over everything
  assert.deepEqual(storyAgent(tenant({ command: ["my-agent"], timeoutMs: 5000 }), { env }), { command: ["my-agent"], timeoutMs: 5000 });
  // null / false disable, whatever the env and the config say
  assert.equal(storyAgent(tenant(null), { env }), null);
  assert.equal(storyAgent(tenant(false), { env }), null);
  // env next, with its timeout
  assert.deepEqual(storyAgent(tenant(), { env }), { command: ENV_CMD, timeoutMs: 90000 });
  // a tenant that spells out the default command does not pin it (alienwatch, ragusa)
  assert.deepEqual(storyAgent(tenant({ ...DEFAULT_STORY_AGENT }), { env }), { command: ENV_CMD, timeoutMs: 90000 });
  // config.json next, read on every call
  assert.deepEqual(storyAgent(tenant(), { env: {} }), { command: SSH, timeoutMs: 180000 });
  assert.deepEqual(storyAgent(tenant({ ...DEFAULT_STORY_AGENT }), { env: {} }), { command: SSH, timeoutMs: 180000 });
  writeConfig({ storyAgent: { command: SSH } });
  assert.deepEqual(storyAgent(tenant(), { env: {} }), { command: SSH, timeoutMs: DEFAULT_STORY_AGENT.timeoutMs });
  // off in config.json → the default, and the tenant's object merged over it as before
  writeConfig({ storyAgent: { enabled: false, command: SSH } });
  assert.deepEqual(storyAgent(tenant(), { env: {} }), DEFAULT_STORY_AGENT);
  assert.deepEqual(storyAgent(tenant({ timeoutMs: 7000 }), { env: {} }), { ...DEFAULT_STORY_AGENT, timeoutMs: 7000 });
  // no config.json at all
  writeFileSync(join(world.home, "config.json"), "{}");
  assert.deepEqual(storyAgent(tenant(), { env: {} }), DEFAULT_STORY_AGENT);
});

test("storyAgent: invalid env or config is ignored, never a throw", () => {
  writeConfig({ storyAgent: { command: SSH, timeoutMs: 180000 } });
  for (const bad of ["", "not json", "{}", "[]", "\"ssh\"", "[1,2]", "[\"ssh\", \"\"]", "[\"ssh\", null]"]) {
    assert.deepEqual(storyAgent(tenant(), { env: { ZIGGY_STORY_AGENT_CMD: bad } }), { command: SSH, timeoutMs: 180000 }, bad);
  }
  assert.deepEqual(storyAgent(tenant(), { env: { ZIGGY_STORY_AGENT_CMD: JSON.stringify(ENV_CMD), ZIGGY_STORY_AGENT_TIMEOUT_MS: "soon" } }), { command: ENV_CMD, timeoutMs: DEFAULT_STORY_AGENT.timeoutMs });
  for (const storyAgentBlock of [null, "ssh", [], { command: "ssh" }, { command: [] }, { command: ["ssh", 3] }]) {
    writeConfig({ storyAgent: storyAgentBlock });
    assert.deepEqual(storyAgent(tenant(), { env: {} }), DEFAULT_STORY_AGENT, JSON.stringify(storyAgentBlock));
  }
  writeFileSync(join(world.home, "config.json"), "{ broken");
  assert.deepEqual(storyAgent(tenant(), { env: {} }), DEFAULT_STORY_AGENT);
  writeFileSync(join(world.home, "config.json"), "{}");
});

test("agentAvailable: a bin on PATH or an executable path; a missing one says why, naming only the bin", () => {
  assert.equal(agentAvailable({ command: ["node", "--secret-arg"] }).ok, true);
  assert.equal(agentAvailable({ command: ["sh"] }).ok, true);
  assert.equal(agentAvailable({ command: [process.execPath] }).ok, true);
  assert.deepEqual(agentAvailable({ command: ["no-such-agent-bin", "-i", "/data/ssh/key"] }), { ok: false, reason: "no-such-agent-bin not found on PATH" });
  assert.deepEqual(agentAvailable({ command: ["node"] }, { env: { PATH: "/nowhere" } }), { ok: false, reason: "node not found on PATH" });
  assert.deepEqual(agentAvailable({ command: ["/nowhere/claude"] }), { ok: false, reason: "/nowhere/claude not found or not executable" });
  const plain = join(world.root, "not-executable");
  writeFileSync(plain, "#!/bin/sh\n");
  chmodSync(plain, 0o644);
  assert.equal(agentAvailable({ command: [plain] }).ok, false);
  assert.deepEqual(agentAvailable(null), { ok: false, reason: "no command" });
});

/* ── the host gate ─────────────────────────────────────────────────────── */

const GATE = join(import.meta.dirname, "..", "..", "ops", "story-agent", "ziggy-agent-gate.sh");
const HAS_SH = process.platform !== "win32" && spawnSync("sh", ["-c", "exit 0"]).status === 0;
const HAS_PERL = HAS_SH && spawnSync("perl", ["-e", "exit 0"]).status === 0;
const gateHome = join(world.root, "agent-home");
const gateBin = join(world.root, "agent-bin");
const claudeLog = join(world.root, "claude.log");
if (HAS_SH) {
  mkdirSync(gateHome, { recursive: true });
  mkdirSync(gateBin, { recursive: true });
  writeFileSync(join(gateBin, "claude"), `#!/bin/sh
{ printf 'cwd=%s\\n' "$(pwd)"; for a in "$@"; do printf 'arg=%s\\n' "$a"; done; printf 'stdin='; cat; } > ${JSON.stringify(claudeLog)}
printf '{"type":"result","result":"fine"}\\n'
`);
  chmodSync(join(gateBin, "claude"), 0o755);
}
const gatePath = `${gateBin}:/usr/bin:/bin`;
const gate = (command, { input = "", env = {} } = {}) => spawnSync("sh", [GATE], {
  input, encoding: "utf8", env: { HOME: gateHome, PATH: "/usr/bin:/bin", ZIGGY_AGENT_GATE_PATH: gatePath, SSH_ORIGINAL_COMMAND: command, ...env },
});

test("agent gate: anything but claude-json, health or nothing is denied with exit 2", { skip: !HAS_SH && "no POSIX sh" }, () => {
  for (const cmd of ["rm -rf /", "claude-json --foo", "health; id", "health now", "claude", "claude -p", "sh -c id", "claude-json\nid", " claude-json"]) {
    const r = gate(cmd);
    assert.equal(r.status, 2, `${JSON.stringify(cmd)} → ${r.status}`);
    assert.match(r.stderr, /denied/);
    assert.equal(r.stdout, "");
  }
  assert.ok(!existsSync(claudeLog), "claude never ran");
});

test("agent gate: health says whether claude is on the gate's PATH", { skip: !HAS_SH && "no POSIX sh" }, () => {
  const ok = gate("health");
  assert.deepEqual([ok.status, ok.stdout], [0, "ok\n"]);
  const none = gate("health", { env: { ZIGGY_AGENT_GATE_PATH: "/usr/bin:/bin" } });
  assert.deepEqual([none.status, none.stdout], [1, "no claude\n"]);
});

test("agent gate: claude-json passes stdin and only `-p --output-format json`, from an empty work dir", { skip: !HAS_PERL && "no POSIX sh or perl" }, () => {
  for (const cmd of ["claude-json", ""]) {
    const r = gate(cmd, { input: "Headline: x\nPoints:\n0. y" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "{\"type\":\"result\",\"result\":\"fine\"}\n");
    assert.equal(readFileSync(claudeLog, "utf8"), `cwd=${join(gateHome, "ziggy-agent", "work")}\narg=-p\narg=--output-format\narg=json\nstdin=Headline: x\nPoints:\n0. y`);
  }
});

test("agent gate: the watchdog stops a claude that runs too long", { skip: !HAS_PERL && "no POSIX sh or perl" }, () => {
  const slowBin = join(world.root, "slow-bin");
  mkdirSync(slowBin, { recursive: true });
  writeFileSync(join(slowBin, "claude"), "#!/bin/sh\nexec sleep 30\n");
  chmodSync(join(slowBin, "claude"), 0o755);
  const started = Date.now();
  const r = gate("claude-json", { env: { ZIGGY_AGENT_GATE_PATH: `${slowBin}:/usr/bin:/bin`, ZIGGY_AGENT_GATE_TIMEOUT: "1" } });
  assert.ok(Date.now() - started < 10_000);
  assert.notEqual(r.status, 0);
});
