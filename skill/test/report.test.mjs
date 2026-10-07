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
