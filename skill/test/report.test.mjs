import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { API_KEY, makeWorld, runCli, startMockPostproxy } from "./helpers.mjs";

const world = makeWorld();
after(world.cleanup);

let mock;
before(async () => {
  mock = await startMockPostproxy({
    posts: {
      p_pub: { id: "p_pub", status: "processed", platforms: [{ platform: "instagram", profile_id: "prof_ig", status: "published", permalink: "https://instagram.com/p/abc123" }], scheduled_at: null },
      p_sched: { id: "p_sched", status: "scheduled", platforms: [{ platform: "instagram", profile_id: "prof_ig", status: "pending" }], scheduled_at: "2026-10-07T05:30:00Z" },
    },
    comments: { p_pub: [{ id: "c1", author_username: "reader", body: "Bella questa", depth: 0 }] },
    stats: { profiles: { prof_ig: [{ recorded_at: "2026-10-06T10:00:00Z", stats: { followers_count: 3, views_7d: 40, reach_7d: 21 } }] } },
  });
});
after(() => mock.close());

const ENV = () => ({ ...world.env, ZIGGY_POSTPROXY_BASE_URL: mock.baseUrl, POSTPROXY_API_KEY: API_KEY });

function logTwoPosts() {
  const dir = join(world.home, "tenants", "acme");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "posts.jsonl");
  const before = existsSync(log) ? readFileSync(log, "utf8") : ""
  appendFileSync(log, JSON.stringify({ postId: "p_pub", campaign: "story-one", platform: "instagram" }) + "\n");
  appendFileSync(log, JSON.stringify({ postId: "p_sched", campaign: "story-two", platform: "instagram" }) + "\n");
  return () => writeFileSync(log, before);
}

test("the report lists published with permalinks, scheduled with times, stats and the inbox", async () => {
  const unlog = logTwoPosts();
  const r = await runCli(["report", "acme"], ENV());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /📊 Acme — \d{2}:\d{2} UTC/);
  assert.match(r.stdout, /✅ 1 pubblicati — ultimo: story one/);
  assert.match(r.stdout, / {3}https:\/\/instagram\.com\/p\/abc123/);
  assert.match(r.stdout, /⏳ in programma:\n {3}🕒 05:30 — story two/);
  assert.match(r.stdout, /📈 instagram Brand: 3 follower · 40 views\/7gg · reach 21\/7gg/);
  assert.match(r.stdout, /📥 inbox: 1 commento 👀/);
  assert.match(r.stdout, /💬 @reader: Bella questa/);
  const j = await runCli(["report", "acme", "--json"], ENV());
  const d = JSON.parse(j.stdout);
  assert.equal(d.published.length, 1);
  assert.equal(d.queued.length, 1);
  assert.equal(d.profiles[0].name, "@brand");
  assert.ok(d.profiles.some((p) => p.name === "Brand"));
  unlog();
});

test("a deleted post drops out of the report instead of breaking it", async () => {
  const dir = join(world.home, "tenants", "acme");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "posts.jsonl");
  if (!existsSync(log)) writeFileSync(log, "");
  appendFileSync(log, JSON.stringify({ postId: "p_gone", campaign: "gone", platform: "instagram" }) + "\n");
  const r = await runCli(["report", "acme", "--all"], ENV());
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes("p_gone"));
  assert.ok(!r.stdout.includes("gone →"));
});

test("publish, delete and reschedule events never show up as extra posts in the report", async () => {
  const unlog = logTwoPosts();
  const log = join(world.home, "tenants", "acme", "posts.jsonl");
  appendFileSync(log, JSON.stringify({ postId: "p_sched", event: "reschedule", scheduledAt: "2026-10-07T06:30:00Z" }) + "\n");
  appendFileSync(log, JSON.stringify({ postId: "p_pub", status: "processed", event: "publish" }) + "\n");
  const j = await runCli(["report", "acme", "--json"], ENV());
  assert.equal(j.status, 0, j.stderr);
  const d = JSON.parse(j.stdout);
  assert.deepEqual(d.published.map((p) => p.campaign), ["story-one"]);
  assert.deepEqual(d.queued.map((p) => p.campaign), ["story-two"]);
  // a deleted post is gone: no queue entry, and the inbox never asks for its comments
  appendFileSync(log, JSON.stringify({ postId: "p_sched", event: "delete" }) + "\n");
  const kept = mock.state.posts.p_sched;
  delete mock.state.posts.p_sched; // what `ziggy delete` does on Postproxy's side
  const callsBefore = mock.calls.length;
  const after = JSON.parse((await runCli(["report", "acme", "--json"], ENV())).stdout);
  assert.deepEqual(after.queued, []);
  assert.ok(!mock.calls.slice(callsBefore).some((c) => c.path.startsWith("/api/posts/p_sched")), "nothing is fetched for a deleted post");
  mock.state.posts.p_sched = kept;
  unlog();
});

test("the queue reads in time order, one line per story even when it goes to two platforms", async () => {
  const log = join(world.home, "tenants", "acme", "posts.jsonl");
  const before = existsSync(log) ? readFileSync(log, "utf8") : "";
  const sched = (id, at, platform) => ({ id, status: "scheduled", platforms: [{ platform, profile_id: "prof_ig", status: "pending" }], scheduled_at: at });
  Object.assign(mock.state.posts, {
    q_late: sched("q_late", "2026-10-07T21:30:00Z", "instagram"),
    q_early_ig: sched("q_early_ig", "2026-10-07T18:30:00Z", "instagram"),
    q_early_tt: sched("q_early_tt", "2026-10-07T18:30:00Z", "tiktok"),
  });
  writeFileSync(log, [
    { postId: "q_late", campaign: "story-late", platform: "instagram" },
    { postId: "q_early_ig", campaign: "story-early", platform: "instagram" },
    { postId: "q_early_tt", campaign: "story-early", platform: "tiktok" },
  ].map((x) => JSON.stringify(x)).join("\n") + "\n");
  const r = await runCli(["report", "acme"], ENV());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /⏳ in programma:\n {3}🕒 18:30 — story early\n {3}🕒 21:30 — story late\n/);
  for (const id of ["q_late", "q_early_ig", "q_early_tt"]) delete mock.state.posts[id];
  writeFileSync(log, before);
});

test("a post removed by hand on the platform is neither published nor queued", async () => {
  const log = join(world.home, "tenants", "acme", "posts.jsonl");
  const before = existsSync(log) ? readFileSync(log, "utf8") : "";
  mock.state.posts.p_removed = { id: "p_removed", status: "processed", platforms: [{ platform: "instagram", profile_id: "prof_ig", status: "deleted" }], scheduled_at: "2026-10-07T15:30:00Z" };
  writeFileSync(log, JSON.stringify({ postId: "p_removed", campaign: "story-removed", platform: "instagram" }) + "\n");
  const d = JSON.parse((await runCli(["report", "acme", "--json"], ENV())).stdout);
  assert.deepEqual(d.published, []);
  assert.deepEqual(d.queued, []);
  delete mock.state.posts.p_removed;
  writeFileSync(log, before);
});
