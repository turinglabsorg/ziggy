import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { policyOf } from "../scripts/autopilot.mjs";
import { route, stateOf } from "../scripts/jev.mjs";
import { API_KEY, fakeHush, makeWorld, runCli, startMockPostproxy } from "./helpers.mjs";

const world = makeWorld();
let mock;
before(async () => {
  mock = await startMockPostproxy({
    posts: { post_a: { id: "post_a", status: "processed", body: "Acme is live.", platforms: [{ platform: "instagram", profile_id: "prof_ig", status: "published", permalink: "https://instagram.com/p/a" }] } },
    comments: {
      post_a: [
        { id: "cmt_fan", text: "This is great, where can I read more?", author: { username: "fan" } },
        { id: "cmt_spam", text: "FREE CRYPTO click here", author: { username: "bot" } },
        { id: "cmt_fire", text: "🔥🔥", author: { username: "lurker" } },
        { id: "cmt_money", text: "my lawyer will hear about this", author: { username: "angry" } },
      ],
    },
    chats: { prof_ig: [{ id: "chat_1", participant_username: "dmfan", unread_count: 1, last_message: { id: "msg_1", body: "hi, do you ship to Italy?", is_outbound: false } }] },
  });
  writeFileSync(join(world.home, "tenants", "acme", "posts.jsonl"), JSON.stringify({ campaign: "launch", kind: "instagram_post", postId: "post_a", profileId: "prof_ig", platform: "instagram" }) + "\n");
});
after(async () => { await mock.close(); world.cleanup(); });

const resetSeen = () => {
  mkdirSync(join(world.home, "tenants", "acme", "inbox"), { recursive: true });
  writeFileSync(join(world.home, "tenants", "acme", "inbox", "seen.json"), JSON.stringify({ comments: {}, messages: {} }));
};
const setTenant = (patch) => {
  const file = join(world.repo, "tenants", "acme", "tenant.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...patch }));
};
/** An agent that replies to everything and counts how often it is asked. */
function countingAgent(name) {
  const dir = join(world.root, name);
  const counter = join(dir, "calls");
  writeFileSync(join(world.root, `${name}.mjs`), `import { appendFileSync, mkdirSync } from "node:fs";
mkdirSync(${JSON.stringify(dir)}, { recursive: true });
appendFileSync(${JSON.stringify(counter)}, "x");
console.log(JSON.stringify({ action: "reply", text: "Thanks! More on acme.example", reason: "answer" }));`);
  return { command: [process.execPath, join(world.root, `${name}.mjs`)], calls: () => { try { return readFileSync(counter, "utf8").length; } catch { return 0; } } };
}
const env = (extra = {}) => ({ ...world.env, ZIGGY_POSTPROXY_BASE_URL: mock.baseUrl, POSTPROXY_API_KEY: API_KEY, ZIGGY_JEV_URL: `${mock.baseUrl}/v1/systemone`, ...extra });

test("route settles only what Jev is sure of, escalation first", () => {
  const item = { type: "comment" };
  assert.equal(route({ escalate: 0.9, spam: 0.95, needs_reply: 0.5 }, item).action, "escalate");
  assert.equal(route({ escalate: 0.1, spam: 0.95, needs_reply: 0.5 }, item).action, "hide");
  assert.equal(route({ escalate: 0.1, spam: 0.95, needs_reply: 0.5 }, { type: "dm" }).action, "skip", "a DM is never hidden");
  assert.equal(route({ escalate: 0.1, spam: 0.1, needs_reply: 0.05 }, item).action, "skip");
  assert.equal(route({ escalate: 0.5, spam: 0.5, needs_reply: 0.5 }, item), null, "unsure → the agent decides");
  assert.equal(route(null, item), null);
  assert.equal(route({ escalate: 0.8, spam: 0, needs_reply: 1 }, item, { escalateAt: 0.75 }).action, "escalate", "thresholds per tenant");
  assert.deepEqual(policyOf({ autopilot: { jev: true } }).jev, { escalateAt: 0.85, spamAt: 0.9, noReplyAt: 0.9 });
  assert.equal(policyOf({ autopilot: {} }).jev, null, "opt-in");
  assert.deepEqual(stateOf({ type: "dm", platform: "instagram", lastMessage: "hi" }), { kind: "direct message", platform: "instagram", message: "hi", post: null });
});

test("with jev on, the agent only sees what needs a written answer", async () => {
  resetSeen();
  const agent = countingAgent("agent_jev");
  setTenant({ autopilot: { mode: "auto", dms: true, skipAuthors: ["acme"], escalateWords: ["refund"], agent: { command: agent.command }, jev: true } });
  const r = await runCli(["autopilot", "acme", "--json"], env({ TYPESAFE_API_KEY: API_KEY }));
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(agent.calls(), 2, "only the question and the DM reach the agent");
  assert.deepEqual(report.jev, { asked: 5, settled: 3 });
  assert.ok(mock.calls.some((c) => c.path === "/api/posts/post_a/comments/cmt_spam/hide"), "spam hidden without the agent");
  assert.ok(report.queued.some((q) => q.item.id === "cmt_money" && q.decision.by === "jev"), "the lawyer goes to a person");
  assert.ok(mock.calls.some((c) => c.method === "POST" && c.path === "/api/posts/post_a/comments" && c.body?.parent_id === "cmt_fan"), "the question is answered");
  const actions = readFileSync(join(world.home, "tenants", "acme", "inbox", "actions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(actions.some((a) => a.action === "skip" && a.by === "jev" && a.itemId === "cmt_fire"));
  assert.ok(actions.some((a) => a.action === "hide" && a.by === "jev"));
  const jevCalls = mock.calls.filter((c) => c.path === "/v1/systemone");
  assert.equal(jevCalls.length, 5);
  assert.ok(jevCalls.every((c) => c.body.model === "jev-1.13.0" && Object.keys(c.body.questions).join() === "escalate,spam,needs_reply"));
});

test("jev unreachable → the agent decides every item, as before", async () => {
  resetSeen();
  const agent = countingAgent("agent_down");
  setTenant({ autopilot: { mode: "draft", dms: true, skipAuthors: ["acme"], escalateWords: ["refund"], agent: { command: agent.command }, jev: true } });
  const r = await runCli(["autopilot", "acme", "--json"], env({ TYPESAFE_API_KEY: API_KEY, ZIGGY_JEV_URL: "http://127.0.0.1:9/v1/systemone" }));
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(agent.calls(), 5);
  assert.deepEqual(report.jev, { asked: 5, settled: 0 });
});

test("without the key in the environment, the scoring runs as its own hush child", async () => {
  resetSeen();
  const agent = countingAgent("agent_hush");
  const hush = fakeHush(join(world.root, "hush"), { names: ["TYPESAFE_API_KEY"], secretValue: API_KEY });
  setTenant({ autopilot: { mode: "draft", dms: true, skipAuthors: ["acme"], escalateWords: ["refund"], agent: { command: agent.command }, jev: true } });
  const before = mock.calls.filter((c) => c.path === "/v1/systemone").length;
  const r = await runCli(["autopilot", "acme", "--json"], env({ TYPESAFE_API_KEY: "", ZIGGY_HUSH_BIN: hush }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(mock.calls.filter((c) => c.path === "/v1/systemone").length - before, 5);
  assert.equal(JSON.parse(r.stdout).jev.settled, 3);
  assert.equal(agent.calls(), 2);
});
