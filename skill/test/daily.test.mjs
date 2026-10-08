import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { coveredStories, dailyConfig, freeSlotTimes, livePosts, storyCovered, uncoveredStories } from "../scripts/daily.mjs";
import { API_KEY, makeWorld, runCli, startMockPostproxy } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;
const { fontsDir, tenantDir } = await import("../scripts/config.mjs");

mkdirSync(fontsDir("acme"), { recursive: true });
for (const f of ["Unbounded", "Geist", "GeistMono"]) writeFileSync(join(fontsDir("acme"), `${f}.woff2`), Buffer.alloc(64, 0));

test("daily config: tenant overrides land on top of the defaults", () => {
  assert.deepEqual(dailyConfig({}), { slots: ["07:30", "13:00", "17:30", "20:00"], tz: "+02:00", maxAgeHours: 48, only: ["instagram_reel"] });
  assert.deepEqual(dailyConfig({ daily: { slots: ["08:00"], tz: "-05:00" } }).slots, ["08:00"]);
  assert.equal(dailyConfig({ daily: { tz: "-05:00" } }).tz, "-05:00");
});

test("free slots: strictly after `from`, in the tenant's fixed offset, skipping our taken ones", () => {
  // 21:00 local (+02:00) → every slot lands tomorrow
  const evening = freeSlotTimes(["07:30", "13:00"], "+02:00", { from: new Date("2026-10-06T19:00:00Z") });
  assert.deepEqual(evening, ["2026-10-07T05:30:00.000Z", "2026-10-07T11:00:00.000Z"]);
  // 06:00 local → the 07:30 slot lands today, the others too
  const dawn = freeSlotTimes(["07:30", "13:00"], "+02:00", { from: new Date("2026-10-06T04:00:00Z") });
  assert.deepEqual(dawn, ["2026-10-06T05:30:00.000Z", "2026-10-06T11:00:00.000Z"]);
  // between slots: 13:00 is today, 07:30 tomorrow — in time order
  const noon = freeSlotTimes(["07:30", "13:00"], "+02:00", { from: new Date("2026-10-06T08:00:00Z") });
  assert.deepEqual(noon, ["2026-10-06T11:00:00.000Z", "2026-10-07T05:30:00.000Z"]);
  // a slot holding one of our posts is skipped, and nothing lands past the 24h horizon
  const taken = new Set([Date.parse("2026-10-07T05:30:00.000Z")]);
  assert.deepEqual(freeSlotTimes(["07:30", "13:00"], "+02:00", { from: new Date("2026-10-06T19:00:00Z"), taken }), ["2026-10-07T11:00:00.000Z"]);
  assert.deepEqual(freeSlotTimes(["07:30"], "+02:00", { from: new Date("2026-10-06T19:00:00Z"), taken }), []);
});

let mock, feedServer, feedPort, items;
before(async () => {
  mock = await startMockPostproxy();
  items = [
    { title: "Harbour reopens after the storm", dek: "Something happened today in town.", storyDate: "2026-10-06T09:00:00Z", sector: { name: "Cronaca" }, imageUrl: "__FEED__/img.jpg", slug: "fresh-story-one", sourceCount: 2, languageCount: 1 },
    { title: "Council approves the school budget", dek: "Another thing happened in the afternoon.", storyDate: "2026-10-06T14:00:00Z", sector: { name: "Economia" }, imageUrl: "__FEED__/img.jpg", slug: "fresh-story-two", sourceCount: 1, languageCount: 1 },
    { title: "Stale story", dek: "This happened days ago.", storyDate: "2026-10-02T09:00:00Z", sector: { name: "Sport" }, imageUrl: "__FEED__/img.jpg", slug: "stale-story", sourceCount: 1, languageCount: 1 },
  ];
  feedServer = createServer((req, res) => {
    if (req.url === "/img.jpg") { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: items.map((it) => ({ ...it, imageUrl: it.imageUrl.replace("__FEED__", `http://127.0.0.1:${feedPort}`) })) }));
  });
  await new Promise((r) => feedServer.listen(0, "127.0.0.1", r));
  feedPort = feedServer.address().port;

  const tenantFile = join(tenantDir("acme"), "tenant.json");
  const tenant = JSON.parse(readFileSync(tenantFile, "utf8"));
  tenant.feed = {
    url: `http://127.0.0.1:${feedPort}/feed`, items: "data",
    fields: { title: "title", dek: "dek", section: "sector.name", date: "storyDate", image: "imageUrl", slug: "slug", sources: "sourceCount", languages: "languageCount" },
    storyUrl: "https://acme.example/#/b/{slug}", displayUrl: "acme.example",
    agent: null,
  };
  tenant.daily = { slots: ["07:30", "13:00", "17:30", "20:00"], tz: "+02:00" };
  writeFileSync(tenantFile, JSON.stringify(tenant, null, 2));
});
after(() => new Promise((r) => { feedServer.closeAllConnections(); feedServer.close(r); mock.close(); }));

const ENV = () => ({ ...world.env, ZIGGY_POSTPROXY_BASE_URL: mock.baseUrl, POSTPROXY_API_KEY: API_KEY, ZIGGY_HYPERFRAMES_BIN: fakeBin });

let fakeBin;
before(() => {
  const dir = join(world.root, "fakehf-daily");
  mkdirSync(dir, { recursive: true });
  fakeBin = join(dir, "hyperframes");
  writeFileSync(fakeBin, `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "check") { console.log("ok"); process.exit(0); }
if (cmd === "render") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, "mp4"); process.exit(0); }
if (cmd === "snapshot") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(o, { recursive: true }); fs.writeFileSync(path.join(o, "frame-00-at-7s.png"), "png"); process.exit(0); }
if (cmd === "--version") { console.log("0.8.133"); process.exit(0); }
process.exit(1);
`);
  chmodSync(fakeBin, 0o755);
});

test("the daily loop: fresh stories become campaigns, rendered and scheduled on the next slots", async () => {
  const r = await runCli(["daily", "acme", "--from", "2026-10-06T19:00:00Z", "--json"], ENV());
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.planned.length, 2, "two fresh stories, the stale one is ignored");
  assert.deepEqual(report.planned.map((p) => p.scheduledAt), ["2026-10-07T05:30:00.000Z", "2026-10-07T11:00:00.000Z"]);
  assert.deepEqual(report.errors, []);
  const creates = mockCalls().filter((x) => x.method === "POST" && x.path === "/api/posts");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates.map((c) => c.fields["post[scheduled_at]"]), ["2026-10-07T05:30:00.000Z", "2026-10-07T11:00:00.000Z"]);
  // second run: everything is covered, nothing is created again
  const postsBefore = mockCalls().filter((x) => x.method === "POST" && x.path === "/api/posts").length;
  const again = await runCli(["daily", "acme", "--from", "2026-10-06T19:05:00Z"], ENV());
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /nothing new/);
  assert.equal(mockCalls().filter((x) => x.method === "POST" && x.path === "/api/posts").length, postsBefore);
});

test("the daily loop never stacks stories on one slot: a later run takes the next free one", async () => {
  items.unshift({ title: "Night market draws record crowds", dek: "A third thing happened in the evening.", storyDate: "2026-10-06T18:00:00Z", sector: { name: "Cronaca" }, imageUrl: "__FEED__/img.jpg", slug: "fresh-story-three", sourceCount: 1, languageCount: 1 });
  const r = await runCli(["daily", "acme", "--from", "2026-10-06T19:10:00Z", "--json"], ENV());
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.planned.map((p) => [p.title, p.scheduledAt]), [["Night market draws record crowds", "2026-10-07T15:30:00.000Z"]], "07:30 and 13:00 already hold stories one and two");
});

test("a deleted post frees its slot and uncovers its story: the next run redoes both", async () => {
  const log = readFileSync(join(world.home, "tenants", "acme", "posts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const first = log.find((x) => x.scheduledAt === "2026-10-07T05:30:00.000Z");
  const del = await runCli(["delete", "acme", first.postId], ENV());
  assert.equal(del.status, 0, del.stderr);
  const r = await runCli(["daily", "acme", "--from", "2026-10-06T19:20:00Z", "--json"], ENV());
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.planned.map((p) => [p.campaign, p.scheduledAt]), [[first.campaign, "2026-10-07T05:30:00.000Z"]]);
});

function mockCalls() { return mock.calls; }

test("ziggy reschedule moves a scheduled post on Postproxy and in the slot accounting", async () => {
  const target = livePosts("acme").find((x) => x.scheduledAt === "2026-10-07T15:30:00.000Z");
  assert.ok(target, "the night market story from the stacking test");
  const r = await runCli(["reschedule", "acme", target.postId, "--at", "2026-10-07T21:15:00Z"], ENV());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`${target.postId}  → 2026-10-07T21:15:00.000Z`));
  const patch = mock.calls.filter((c) => c.method === "PATCH").at(-1);
  assert.equal(patch.path, `/api/posts/${target.postId}`);
  assert.equal(mock.state.posts[target.postId].scheduled_at, "2026-10-07T21:15:00.000Z");
  assert.equal(livePosts("acme").find((x) => x.postId === target.postId).scheduledAt, "2026-10-07T21:15:00.000Z");
  // the slot it left is free again, the new one is taken
  const free = freeSlotTimes(["17:30", "23:15"], "+02:00", { from: new Date("2026-10-07T12:00:00Z"), taken: new Set(livePosts("acme").map((x) => Date.parse(x.scheduledAt))) });
  assert.deepEqual(free, ["2026-10-07T15:30:00.000Z"]);
  const bad = await runCli(["reschedule", "acme", target.postId], ENV());
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /usage: ziggy reschedule/);
});

test("a campaign marked skip covers its story without any post: the loop leaves it alone", () => {
  const dir = join(world.repo, "tenants", "acme", "campaigns", "story-2026-10-07-confronto-pubblico-ieri");
  mkdirSync(dir, { recursive: true });
  const story = { slug: "confronto-pubblico-ieri-6d6c2f52", title: "Confronto pubblico ieri sera in piazza" };
  writeFileSync(join(dir, "campaign.json"), JSON.stringify({ template: "story", story: { slug: story.slug }, copy: { headline: story.title } }));
  assert.equal(storyCovered(story, coveredStories("acme")), false, "no post, no skip: still to do");
  writeFileSync(join(dir, "campaign.json"), JSON.stringify({ template: "story", skip: true, story: { slug: story.slug }, copy: { headline: story.title } }));
  assert.equal(storyCovered(story, coveredStories("acme")), true);
});
