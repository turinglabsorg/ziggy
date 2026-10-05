import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { buildPrompt, parseDecision, policyOf, triage } from "../scripts/autopilot.mjs";
import { API_KEY, fakeAgent, makeWorld, runCli, startMockPostproxy } from "./helpers.mjs";

const CLI = join(import.meta.dirname, "..", "index.js");
const world = makeWorld();
let mock;
before(async () => {
  mock = await startMockPostproxy({
    posts: {
      post_a: { id: "post_a", status: "processed", body: "Acme is live.", platforms: [{ platform: "instagram", profile_id: "prof_ig", status: "published", permalink: "https://instagram.com/p/a" }] },
      post_b: { id: "post_b", status: "processed", body: "tweet", platforms: [{ platform: "twitter", profile_id: "prof_x", status: "published", permalink: "https://x.com/acme/status/1" }] },
    },
    comments: {
      post_a: [
        { id: "cmt_fan", text: "This is great, where can I read more?", author: { username: "fan" } },
        { id: "cmt_spam", text: "FREE CRYPTO click here", author: { username: "bot" } },
        { id: "cmt_money", text: "I want a REFUND for my MONEY", author: { username: "angry" } },
        { id: "cmt_self", text: "thanks all", author: { username: "acme" }, is_own: true },
      ],
    },
    chats: { prof_ig: [{ id: "chat_1", participant_username: "dmfan", unread_count: 1, last_message: { id: "msg_1", body: "hi, do you ship to Italy?", is_outbound: false } }] },
  });
  // the tenant's posts are known from its publish log
  writeFileSync(join(world.home, "tenants", "acme", "posts.jsonl"), [
    JSON.stringify({ campaign: "launch", kind: "instagram_post", postId: "post_a", profileId: "prof_ig", platform: "instagram" }),
    JSON.stringify({ campaign: "launch", kind: "twitter", postId: "post_b", profileId: "prof_x", platform: "twitter" }),
  ].join("\n") + "\n");
});
after(async () => { await mock.close(); world.cleanup(); });

const run = (args, extraEnv = {}) => runCli(args, { ...world.env, ZIGGY_POSTPROXY_BASE_URL: mock.baseUrl, POSTPROXY_API_KEY: API_KEY, ...extraEnv });
const setTenant = (patch) => {
  const file = join(world.repo, "tenants", "acme", "tenant.json");
  const t = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...t, ...patch }));
};

test("inbox surfaces new comments on our posts (not our own), DMs, and marks them seen once", async () => {
  let r = await run(["inbox", "acme", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.comments.new.map((c) => c.id).sort(), ["cmt_fan", "cmt_money", "cmt_spam"]);
  assert.equal(out.chats.length, 1);
  assert.equal(out.chats[0].isNew, true);
  assert.ok(!mock.calls.some((c) => c.path === "/api/posts/post_b/comments"), "X has no comment API, so it is never asked");
  r = await run(["inbox", "acme", "--json"]);
  assert.deepEqual(JSON.parse(r.stdout).comments.new, [], "second pull: nothing new");
  r = await run(["inbox", "acme", "--all", "--json"]);
  assert.equal(JSON.parse(r.stdout).comments.all.length, 4);
});

test("policy, triage and prompt are deterministic", async () => {
  const tenant = { slug: "acme", dir: join(world.repo, "tenants", "acme"), name: "Acme", brand: { name: "Acme" }, autopilot: { mode: "auto", skipAuthors: ["@Acme"], escalateWords: ["refund"] } };
  const policy = policyOf(tenant);
  assert.equal(policy.mode, "auto");
  assert.deepEqual(triage({ author: "acme", body: "hi" }, policy), { action: "skip", reason: "author on skip list" });
  assert.equal(triage({ author: "x", body: "I want a refund" }, policy).action, "escalate");
  assert.equal(triage({ author: "x", body: "nice" }, policy), null);
  const prompt = buildPrompt({ tenant, playbook: "# PB\nBe nice.", item: { type: "comment", platform: "instagram", postId: "post_a", author: "fan", body: "where?" }, policy });
  assert.match(prompt, /^# PB/);
  assert.match(prompt, /@fan wrote/);
  assert.match(prompt, /"action": "reply" \| "skip" \| "hide" \| "escalate"/);
});

test("parseDecision accepts claude -p JSON envelopes and bare JSON, rejects garbage", async () => {
  assert.deepEqual(parseDecision('{"type":"result","result":"Here: {\\"action\\":\\"reply\\",\\"text\\":\\"Thanks!\\",\\"reason\\":\\"r\\"}"}').action, "reply");
  assert.equal(parseDecision('{"action":"HIDE","text":""}').action, "hide");
  assert.throws(() => parseDecision("no json here"), /no JSON decision/);
  assert.throws(() => parseDecision('{"action":"explode"}'), /unknown action/);
});

test("autopilot in draft mode queues proposals and posts nothing", async () => {
  // reset seen so the comments count as new again
  writeFileSync(join(world.home, "tenants", "acme", "inbox", "seen.json"), JSON.stringify({ comments: {}, messages: {} }));
  const agent = fakeAgent(join(world.root, "agent"), { action: "reply", text: "Thanks — more on acme.example", reason: "answer" });
  setTenant({ autopilot: { mode: "draft", dms: true, skipAuthors: ["acme"], escalateWords: ["refund"], agent: { command: agent } } });
  const before = mock.calls.filter((c) => c.method === "POST").length;
  const r = await run(["autopilot", "acme", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.mode, "draft");
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, before, "draft mode never posts");
  const queued = report.queued.map((q) => [q.item.id, q.decision.action]);
  assert.ok(queued.some(([id, a]) => id === "cmt_fan" && a === "reply"));
  assert.ok(queued.some(([id, a]) => id === "cmt_money" && a === "escalate"), "escalation keyword wins before the agent is asked");
  assert.ok(queued.some(([id, a]) => id === "chat_1" && a === "reply"), "DMs are handled when policy.dms is on");
  assert.ok(existsSync(join(world.home, "tenants", "acme", "inbox", "queue.jsonl")));
  const q = await run(["queue", "acme", "--json"]);
  assert.ok(JSON.parse(q.stdout).length >= 3);
});

test("autopilot in auto mode replies, hides, and logs every action", async () => {
  writeFileSync(join(world.home, "tenants", "acme", "inbox", "seen.json"), JSON.stringify({ comments: {}, messages: {} }));
  const agent = fakeAgent(join(world.root, "agent2"), { action: "reply", text: "Thanks!", reason: "answer" });
  // a second fake agent that hides spam: decide by content
  writeFileSync(join(world.root, "agent2", "agent.mjs"), `import { readFileSync } from "node:fs";
const p = readFileSync(0, "utf8");
const d = /FREE CRYPTO/.test(p) ? { action: "hide", reason: "spam" } : /MONEY/.test(p) ? { action: "escalate", reason: "money" } : { action: "reply", text: "Thanks! More on acme.example", reason: "answer" };
console.log(JSON.stringify(d));`);
  setTenant({ autopilot: { mode: "auto", dms: true, skipAuthors: ["acme"], escalateWords: ["refund"], agent: { command: agent } } });
  const r = await run(["autopilot", "acme", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  const replyCall = mock.calls.find((c) => c.method === "POST" && c.path === "/api/posts/post_a/comments" && c.body?.parent_id === "cmt_fan");
  assert.ok(replyCall, "replied under the fan's comment");
  assert.equal(replyCall.body.body, "Thanks! More on acme.example");
  assert.ok(mock.calls.some((c) => c.path === "/api/posts/post_a/comments/cmt_spam/hide"), "spam hidden");
  assert.ok(mock.calls.some((c) => c.method === "POST" && c.path === "/api/chats/chat_1/messages"), "DM answered");
  assert.ok(report.queued.some((q) => q.item.id === "cmt_money"), "money → human");
  const actions = readFileSync(join(world.home, "tenants", "acme", "inbox", "actions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(actions.some((a) => a.action === "reply" && a.by === "autopilot"));
  assert.ok(actions.some((a) => a.action === "hide"));
});

test("no agent configured → everything escalates, nothing posted", async () => {
  writeFileSync(join(world.home, "tenants", "acme", "inbox", "seen.json"), JSON.stringify({ comments: {}, messages: {} }));
  setTenant({ autopilot: { mode: "auto", agent: null, skipAuthors: ["acme"] } });
  const before = mock.calls.filter((c) => c.method === "POST").length;
  const r = await run(["autopilot", "acme", "--json"]);
  const report = JSON.parse(r.stdout);
  assert.equal(report.handled.length, 0);
  assert.ok(report.queued.every((q) => q.decision.action === "escalate"));
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, before);
});

test("manual reply/hide/dm/stats commands", async () => {
  let r = await run(["reply", "acme", "post_a", "cmt_fan", "--text", "Glad you like it", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(mock.calls.at(-1).body, { body: "Glad you like it", parent_id: "cmt_fan" });
  r = await run(["hide", "acme", "post_a", "cmt_spam"]);
  assert.equal(r.status, 0, r.stderr);
  r = await run(["dm", "acme", "chat_1", "--text", "Yes, worldwide."]);
  assert.equal(r.status, 0, r.stderr);
  r = await run(["stats", "acme", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.profiles.length, 2);
  assert.equal(mock.calls.filter((c) => c.path === "/api/posts/stats").at(-1).query.post_ids, "post_a,post_b");
});

test("watch --install --dry-run renders a schedule without touching the system", async () => {
  const r = await run(["watch", "acme", "--install", "--interval", "600", "--dry-run", "--bin", "/usr/local/bin/ziggy", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  if (out.kind === "launchd") { assert.match(out.plist, /<integer>600<\/integer>/); assert.match(out.plist, /autopilot/); }
  else assert.match(out.line, /\*\/10 \* \* \* \* \/usr\/local\/bin\/ziggy autopilot acme --quiet/);
  assert.equal(out.loaded, false);
});
