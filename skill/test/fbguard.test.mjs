import assert from "node:assert/strict";
import { after, test } from "node:test";

import { logPost, readPostLog, saveCampaign } from "../scripts/config.mjs";
import { livePosts } from "../scripts/daily.mjs";
import { FB_DEFAULTS, fbAllowed, fbGuardConfig, isSpamBlock, lastSpamBlock, queuedInPause } from "../scripts/fbguard.mjs";
import { createClient } from "../scripts/postproxy.mjs";
import { runRound, scheduleRound } from "../scripts/round.mjs";
import { API_KEY, makeWorld, startMockPostproxy } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;

const H = 3600_000;
const BLOCK = { platform: "facebook", status: "failed", error: "Facebook API Error: You're temporarily blocked from this action due to policy violations.", error_details: { platform_error_code: "368", platform_error_subcode: "1390008" } };
const dayOf = (ms) => new Date(ms + 2 * H).toISOString().slice(0, 10);

test("fb guard config: defaults, tenant overrides, off switch", () => {
  const d = fbGuardConfig({});
  assert.deepEqual([d.enabled, d.maxPerDay, d.minGapMs, d.pauseMs], [true, FB_DEFAULTS.maxPerDay, FB_DEFAULTS.minGapMinutes * 60_000, FB_DEFAULTS.pauseHours * H]);
  const o = fbGuardConfig({ daily: { facebook: { maxPerDay: 3, minGapMinutes: 240, pauseHours: 12 } } });
  assert.deepEqual([o.maxPerDay, o.minGapMs, o.pauseMs], [3, 240 * 60_000, 12 * H]);
  assert.equal(fbGuardConfig({ daily: { facebook: { enabled: false } } }).enabled, false);
});

test("isSpamBlock: 368 by code or by message, only for failed Facebook entries", () => {
  assert.ok(isSpamBlock(BLOCK));
  assert.ok(isSpamBlock({ ...BLOCK, error_details: null }));
  assert.ok(!isSpamBlock({ ...BLOCK, status: "published" }));
  assert.ok(!isSpamBlock({ ...BLOCK, platform: "instagram" }));
  assert.ok(!isSpamBlock({ platform: "facebook", status: "failed", error: "Request processing failed", error_details: { platform_error_code: "1" } }));
});

test("fbAllowed: pause after a block, gap between posts, daily cap", () => {
  const cfg = fbGuardConfig({});
  const t = Date.parse("2026-10-19T05:00:00Z"); // 07:00 local
  assert.equal(fbAllowed(t, { fbTimes: [], blockedAt: t - 2 * H, cfg, dayOf }).reason, "pause");
  assert.ok(fbAllowed(t, { fbTimes: [], blockedAt: t - 25 * H, cfg, dayOf }).ok);
  assert.equal(fbAllowed(t, { fbTimes: [t - 2 * H], blockedAt: null, cfg, dayOf }).reason, "gap");
  assert.ok(fbAllowed(t, { fbTimes: [t - 3 * H], blockedAt: null, cfg, dayOf }).ok);
  // six already on the 19th (local): a seventh that day is over the cap, the next day is fine
  const six = [7, 10, 13, 16, 19, 22].map((h) => Date.parse(`2026-10-19T${String(h - 2).padStart(2, "0")}:00:00Z`));
  assert.equal(fbAllowed(Date.parse("2026-10-19T21:30:00Z"), { fbTimes: six, blockedAt: null, cfg: { ...cfg, minGapMs: 0 }, dayOf }).reason, "cap");
  assert.ok(fbAllowed(Date.parse("2026-10-20T05:00:00Z"), { fbTimes: six, blockedAt: null, cfg: { ...cfg, minGapMs: 0 }, dayOf }).ok);
});

test("lastSpamBlock: newest due Facebook post with a 368; future and unreadable posts ignored", async () => {
  const now = Date.parse("2026-10-18T18:30:00Z");
  const mock = await startMockPostproxy({ posts: {
    ok1: { id: "ok1", platforms: [{ platform: "facebook", status: "published" }] },
    bad1: { id: "bad1", platforms: [BLOCK] },
  } });
  try {
    const client = createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });
    const rows = [
      { postId: "bad1", scheduledAt: "2026-10-18T16:00:00Z" },
      { postId: "ok1", scheduledAt: "2026-10-18T17:00:00Z" },
      { postId: "gone", scheduledAt: "2026-10-18T18:00:00Z" },
      { postId: "future", scheduledAt: "2026-10-18T20:00:00Z" },
    ];
    assert.equal(await lastSpamBlock(rows, client, { now }), Date.parse("2026-10-18T16:00:00Z"));
    assert.equal(await lastSpamBlock(rows.slice(1), client, { now }), null);
  } finally { await mock.close(); }
});

test("scheduleRound: Instagram on every slot, Facebook spaced, capped and paused after a 368", async () => {
  const now = new Date("2026-10-18T18:30:00Z"); // 20:30 local
  // a Facebook post that hit the 368 at 18:00 local today
  logPost("acme", { campaign: "old", kind: "facebook_reel", postId: "bad1", profileId: "prof_fb", platform: "facebook", status: "scheduled", live: true, scheduledAt: "2026-10-18T16:00:00.000Z" });
  const mock = await startMockPostproxy({
    profiles: [
      { id: "prof_ig", name: "Brand", platform: "instagram", status: "active", profile_group_id: "grp_1" },
      { id: "prof_fb", name: "Brand Page", platform: "facebook", status: "active", profile_group_id: "grp_1" },
    ],
    posts: { bad1: { id: "bad1", platforms: [BLOCK] } },
  });
  try {
    const client = createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });
    const tenant = { slug: "acme", name: "Acme", daily: { tz: "+02:00", only: ["instagram_reel", "facebook_reel"], freshness: "archive", round: { times: Array.from({ length: 17 }, (_, h) => `${String(h + 7).padStart(2, "0")}:00`), gapMinutes: 55 } } };
    const items = Array.from({ length: 30 }, (_, i) => ({ name: `s${i}`, campaign: { story: { date: "2026-10-18T10:00:00Z" }, posts: {} } }));
    const { results, facebook } = await scheduleRound(tenant, items, { client, now, dryRun: true });
    const withFb = results.filter((r) => r.kinds.includes("facebook_reel"));
    assert.equal(results.filter((r) => r.kinds.includes("instagram_reel")).length, 30, "Instagram keeps every slot");
    assert.equal(facebook.pausedUntil, "2026-10-19T16:00:00.000Z");
    assert.ok(withFb.every((r) => Date.parse(r.at) >= Date.parse(facebook.pausedUntil)), "no Facebook during the pause");
    const times = withFb.map((r) => Date.parse(r.at)).sort((a, b) => a - b);
    assert.ok(times.every((t, i) => i === 0 || t - times[i - 1] >= 150 * 60_000), "Facebook at least 2.5 h apart");
    const perDay = {};
    for (const t of times) perDay[dayOf(t)] = (perDay[dayOf(t)] || 0) + 1;
    assert.ok(Object.values(perDay).every((n) => n <= 6), "at most 6 Facebook posts a day");
    assert.ok(withFb.length >= 2, "Facebook resumes after the pause");
    assert.equal(facebook.held.length, 30 - withFb.length);
  } finally { await mock.close(); }
});

// after a 368 at 18:00 local on the 18th (pause 48 h, until 18:00 on the 20th): Facebook-only posts
// queued inside the pause and after it, one whose Postproxy post also carries Instagram, and the
// Instagram twins, each a post of its own
const NOW = new Date("2026-10-18T18:30:00Z");
const PROFILES = [
  { id: "prof_ig", name: "Brand", platform: "instagram", status: "active", profile_group_id: "grp_1" },
  { id: "prof_fb", name: "Brand Page", platform: "facebook", status: "active", profile_group_id: "grp_1" },
];
const TIMES = Array.from({ length: 17 }, (_, h) => `${String(h + 7).padStart(2, "0")}:00`);
const fbTenant = (slug, facebook = { maxPerDay: 3, minGapMinutes: 240, pauseHours: 48 }) => ({
  slug, name: "Acme", feed: { url: "http://feed.test/feed?limit=20", items: "data" },
  daily: { tz: "+02:00", only: ["instagram_reel", "facebook_reel"], freshness: "archive", round: { times: TIMES, gapMinutes: 55 }, facebook },
});
const scheduledOn = (id, at, ...platforms) => ({ id, status: "scheduled", scheduled_at: at, platforms: platforms.map((platform) => ({ platform, status: "scheduled" })) });

function seedBlockedQueue(slug) {
  const row = (campaign, platform, postId, scheduledAt) => logPost(slug, { campaign, kind: `${platform}_reel`, postId, profileId: `prof_${platform === "facebook" ? "fb" : "ig"}`, platform, status: "scheduled", live: true, scheduledAt });
  row("old", "facebook", "bad1", "2026-10-18T16:00:00.000Z");
  row("tue", "instagram", "ig_tue", "2026-10-19T08:00:00.000Z");
  row("tue", "facebook", "fb_tue", "2026-10-19T08:00:00.000Z");
  row("mix", "facebook", "fb_mix", "2026-10-19T12:00:00.000Z");
  row("wed", "instagram", "ig_wed", "2026-10-20T10:00:00.000Z");
  row("wed", "facebook", "fb_wed", "2026-10-20T10:00:00.000Z");
  row("thu", "facebook", "fb_thu", "2026-10-21T08:00:00.000Z");
  return {
    bad1: { id: "bad1", status: "processed", platforms: [BLOCK] },
    ig_tue: scheduledOn("ig_tue", "2026-10-19T08:00:00.000Z", "instagram"),
    fb_tue: scheduledOn("fb_tue", "2026-10-19T08:00:00.000Z", "facebook"),
    fb_mix: scheduledOn("fb_mix", "2026-10-19T12:00:00.000Z", "facebook", "instagram"),
    ig_wed: scheduledOn("ig_wed", "2026-10-20T10:00:00.000Z", "instagram"),
    fb_wed: scheduledOn("fb_wed", "2026-10-20T10:00:00.000Z", "facebook"),
    fb_thu: scheduledOn("fb_thu", "2026-10-21T08:00:00.000Z", "facebook"),
  };
}
const deletes = (mock) => mock.calls.filter((c) => c.method === "DELETE").map((c) => c.path);
const events = (slug) => readPostLog(slug).filter((r) => r.event).map(({ postId, event }) => ({ postId, event }));

test("queuedInPause: future Facebook rows due before the pause ends, once each; nothing without a block", () => {
  const rows = [
    { postId: "past", scheduledAt: "2026-10-18T10:00:00Z" },
    { postId: "in", scheduledAt: "2026-10-19T08:00:00Z" },
    { postId: "in", scheduledAt: "2026-10-19T08:00:00Z" },
    { postId: "after", scheduledAt: "2026-10-21T08:00:00Z" },
  ];
  const opts = { now: NOW.getTime(), blockedAt: Date.parse("2026-10-18T16:00:00Z"), pauseMs: 48 * H };
  assert.deepEqual(queuedInPause(rows, opts).map((r) => r.postId), ["in"]);
  assert.deepEqual(queuedInPause(rows, { ...opts, blockedAt: null }), []);
});

test("scheduleRound after a 368, dry run: says which queued Facebook posts would go, deletes nothing", async () => {
  const mock = await startMockPostproxy({ profiles: PROFILES, posts: seedBlockedQueue("fbdry") });
  try {
    const client = createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });
    const { results, facebook } = await scheduleRound(fbTenant("fbdry"), [], { client, now: NOW, dryRun: true });
    assert.deepEqual(results, []);
    assert.equal(facebook.pausedUntil, "2026-10-20T16:00:00.000Z");
    assert.deepEqual(facebook.dropped.map((d) => [d.postId, d.campaign, d.dryRun]), [["fb_tue", "tue", true], ["fb_wed", "wed", true]]);
    assert.deepEqual(facebook.flagged.map((f) => [f.postId, f.platforms]), [["fb_mix", ["instagram"]]]);
    assert.deepEqual(deletes(mock), []);
    assert.deepEqual(events("fbdry"), []);
    assert.equal(Object.keys(mock.state.posts).length, 7);
  } finally { await mock.close(); }
});

test("scheduleRound after a 368: Facebook-only posts inside the pause deleted and logged, mixed post flagged, Instagram untouched, a failed delete reported", async () => {
  const mock = await startMockPostproxy({ profiles: PROFILES, posts: seedBlockedQueue("fbdrop") });
  try {
    const client = createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });
    const flaky = { ...client, deletePost: (id) => (id === "fb_wed" ? Promise.reject(new Error("Postproxy DELETE /api/posts/fb_wed → 500\nupstream")) : client.deletePost(id)) };
    const { facebook } = await scheduleRound(fbTenant("fbdrop"), [], { client: flaky, now: NOW });
    assert.deepEqual(facebook.dropped.map((d) => d.postId), ["fb_tue"]);
    assert.deepEqual(facebook.dropErrors.map((e) => [e.postId, e.error]), [["fb_wed", "Postproxy DELETE /api/posts/fb_wed → 500"]]);
    assert.deepEqual(facebook.flagged.map((f) => f.postId), ["fb_mix"]);
    assert.deepEqual(deletes(mock), ["/api/posts/fb_tue"]);
    assert.deepEqual(Object.keys(mock.state.posts).sort(), ["bad1", "fb_mix", "fb_thu", "fb_wed", "ig_tue", "ig_wed"]);
    // logged like `ziggy delete`: the post leaves livePosts, its Instagram twin keeps the story covered
    assert.deepEqual(events("fbdrop"), [{ postId: "fb_tue", event: "delete" }]);
    const live = livePosts("fbdrop").map((r) => r.postId);
    assert.ok(!live.includes("fb_tue"));
    assert.ok(["ig_tue", "ig_wed", "fb_mix", "fb_wed", "fb_thu"].every((id) => live.includes(id)));
  } finally { await mock.close(); }
});

test("runRound after a 368, even with nothing new: the report says how many queued Facebook posts came off", async () => {
  const mock = await startMockPostproxy({ profiles: PROFILES, posts: seedBlockedQueue("fbreport") });
  const fetchImpl = async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const client = createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });
    const dry = await runRound(fbTenant("fbreport"), {}, { fetchImpl, client, now: NOW, dryRun: true });
    assert.match(dry.text, /^📘 2 post Facebook già in coda da togliere \(blocco Meta 368, pausa fino alle 20\/10 18:00\); Instagram resta$/m);
    assert.deepEqual(deletes(mock), []);
    const r = await runRound(fbTenant("fbreport"), {}, { fetchImpl, client, now: NOW });
    assert.match(r.text, /^📘 2 post Facebook già in coda tolti \(blocco Meta 368, pausa fino alle 20\/10 18:00\); Instagram resta$/m);
    assert.match(r.text, /^✗ Facebook fb_mix \(mix\): in coda durante il blocco 368, non tolto perché è anche su instagram$/m);
    assert.match(r.text, /niente di nuovo da programmare/);
    assert.equal(r.ok, false, "the flagged post needs a look");
    assert.deepEqual(r.down, []);
    assert.deepEqual(deletes(mock).sort(), ["/api/posts/fb_tue", "/api/posts/fb_wed"]);
    assert.deepEqual(events("fbreport").map((e) => e.postId).sort(), ["fb_tue", "fb_wed"]);
  } finally { await mock.close(); }
});

test("scheduleRound: one Facebook post per story — by campaign name, by story id, and within the round", async () => {
  const slug = "fbdup";
  saveCampaign(slug, "story-2026-10-17-harbour-reopens", { story: { slug: "harbour-reopens-71903f2c-8e18e4cd" }, posts: {} });
  logPost(slug, { campaign: "story-2026-10-17-harbour-reopens", kind: "facebook_reel", postId: "fb_harbour", profileId: "prof_fb", platform: "facebook", status: "scheduled", live: true, scheduledAt: "2026-10-17T10:00:00.000Z" });
  logPost(slug, { campaign: "story-2026-10-17-ferry", kind: "instagram_reel", postId: "ig_ferry", profileId: "prof_ig", platform: "instagram", status: "scheduled", live: true, scheduledAt: "2026-10-17T12:00:00.000Z" });
  const mock = await startMockPostproxy({ profiles: PROFILES, posts: { fb_harbour: { id: "fb_harbour", status: "processed", platforms: [{ platform: "facebook", status: "published" }] } } });
  try {
    const client = createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });
    const item = (name, slugOf, date) => ({ name, campaign: { story: { slug: slugOf, date }, posts: {} } });
    const items = [
      item("story-2026-10-17-harbour-reopens", "harbour-reopens-71903f2c-8e18e4cd", "2026-10-17T08:00:00Z"), // already on Facebook
      item("story-2026-10-18-harbour-reopens-today", "harbour-reopens-today-71903f2c-0badf00d", "2026-10-18T08:00:00Z"), // same story, re-slugged
      item("story-2026-10-18-market-opens", "market-opens-aaaa1111-bbbb2222", "2026-10-18T09:00:00Z"),
      item("story-2026-10-18-market-opens-again", "market-opens-again-aaaa1111-cccc3333", "2026-10-18T07:00:00Z"), // same story, earlier in this round
      item("story-2026-10-17-ferry", "ferry-late", "2026-10-17T12:00:00Z"), // only on Instagram so far
      { name: "casefile-x", campaign: { posts: {} } },
    ];
    const tenant = fbTenant(slug, { maxPerDay: 10, minGapMinutes: 0, pauseHours: 48 });
    const { results, facebook } = await scheduleRound(tenant, items, { client, now: NOW, dryRun: true });
    assert.equal(results.filter((r) => r.kinds.includes("instagram_reel")).length, 6, "Instagram keeps every story");
    assert.deepEqual(results.filter((r) => r.kinds.includes("facebook_reel")).map((r) => r.name).sort(), ["casefile-x", "story-2026-10-17-ferry", "story-2026-10-18-market-opens"]);
    assert.deepEqual(Object.fromEntries(facebook.held.map((h) => [h.name, h.reason])), {
      "story-2026-10-17-harbour-reopens": "duplicate",
      "story-2026-10-18-harbour-reopens-today": "duplicate",
      "story-2026-10-18-market-opens-again": "duplicate",
    });
  } finally { await mock.close(); }
});
