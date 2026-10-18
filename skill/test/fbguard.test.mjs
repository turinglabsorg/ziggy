import assert from "node:assert/strict";
import { after, test } from "node:test";

import { FB_DEFAULTS, fbAllowed, fbGuardConfig, isSpamBlock, lastSpamBlock } from "../scripts/fbguard.mjs";
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
    const { createClient } = await import("../scripts/postproxy.mjs");
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
  const { scheduleRound } = await import("../scripts/round.mjs");
  const { logPost } = await import("../scripts/config.mjs");
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
    const { createClient } = await import("../scripts/postproxy.mjs");
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
