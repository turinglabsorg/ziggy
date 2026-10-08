/**
 * The daily loop as a single command: feed → new story campaigns → rendered reels →
 * tomorrow's (or today's remaining) slots on Postproxy. `ziggy daily <slug>` is meant to be
 * run by an external scheduler (launchd, cron, systemd timer) — the cadence lives outside
 * ziggy, the timezone and slots live with the tenant:
 *
 *   "daily": {
 *     "slots": ["07:30", "13:00", "17:30", "20:00"],   // local times, first story first slot
 *     "tz": "+02:00",                                   // fixed UTC offset for the slots
 *     "maxAgeHours": 48,                                // older feed stories are left alone
 *     "only": ["instagram_reel"]                        // which post kinds to schedule
 *   }
 *
 * Idempotent: a story already covered by a campaign (matched on story.slug) is never
 * re-created, re-rendered or re-scheduled, so the timer can fire as often as it likes.
 * One story failing must not sink the run — errors are collected per story.
 */
import { existsSync } from "node:fs";
import { listCampaigns, loadCampaign, loadConfig, readPostLog } from "./config.mjs";
import { fetchStories, createStoryCampaign, slugify } from "./story.mjs";
import { produce, resolveVariants } from "./video.mjs";
import { publishCampaign } from "./publish.mjs";
import { createClient } from "./postproxy.mjs";

export const DEFAULT_DAILY = {
  slots: ["07:30", "13:00", "17:30", "20:00"],
  tz: "+02:00",
  maxAgeHours: 48,
  only: ["instagram_reel"],
};

export function dailyConfig(tenant) {
  const d = tenant.daily || {};
  return {
    slots: Array.isArray(d.slots) && d.slots.length ? d.slots.map(String) : [...DEFAULT_DAILY.slots],
    tz: typeof d.tz === "string" ? d.tz : DEFAULT_DAILY.tz,
    maxAgeHours: typeof d.maxAgeHours === "number" ? d.maxAgeHours : DEFAULT_DAILY.maxAgeHours,
    only: Array.isArray(d.only) && d.only.length ? d.only : [...DEFAULT_DAILY.only],
  };
}

/**
 * The posts we created and still have: `ziggy delete` logs a delete event per id, and a
 * deleted post neither covers its story nor holds its slot — the next run redoes both.
 */
export function livePosts(slug) {
  const log = readPostLog(slug);
  const deleted = new Set(log.filter((r) => r.event === "delete").map((r) => r.postId));
  // `ziggy reschedule` logs the post's new time; the last move wins
  const moved = new Map(log.filter((r) => r.event === "reschedule").map((r) => [r.postId, r.scheduledAt]));
  return log.filter((r) => r.postId && !r.event && !deleted.has(r.postId))
    .map((r) => (moved.has(r.postId) ? { ...r, scheduledAt: moved.get(r.postId) } : r));
}

/**
 * Coverage = a post exists (scheduled or published) for the story, not just a campaign on
 * disk: a campaign that failed mid-render must be picked up again by the next run. The feed
 * re-slugs a story when it is updated (new content hash, tweaked title), so the exact slug
 * is not enough — the headline tokens catch the same event under a new name.
 */
export function coveredStories(slug) {
  const posted = new Set(livePosts(slug).map((r) => r.campaign).filter(Boolean));
  const covered = [];
  for (const name of listCampaigns(slug)) {
    try {
      const c = loadCampaign(slug, name);
      // `"skip": true` in campaign.json: an editor dropped the story (e.g. an event already past)
      if (!posted.has(name) && !c.skip) continue;
      if (c.story?.slug || c.copy?.headline) covered.push({ slug: c.story?.slug || null, tokens: titleTokens(c.copy?.headline || "") });
    } catch { /* a broken campaign does not block the run */ }
  }
  return covered;
}

/** Significant title words: slug tokens minus stop-short words and the feed's hex id segments. */
export function titleTokens(title) {
  return new Set(slugify(title).split("-").filter((w) => w.length > 2 && !/^[0-9a-f]{6,}$/.test(w)));
}

/** Covered when the stripped slug matches, or ≥25% of the story's title words are already covered. */
export function storyCovered(story, covered) {
  const bare = String(story.slug || "").replace(/(?:-[0-9a-f]{6,})+$/, "");
  const tokens = titleTokens(story.title || "");
  for (const c of covered) {
    if (c.slug && bare === String(c.slug).replace(/(?:-[0-9a-f]{6,})+$/, "")) return true;
    if (!tokens.size || !c.tokens.size) continue;
    let hit = 0;
    for (const w of tokens) if (c.tokens.has(w)) hit++;
    if (hit / tokens.size >= 0.25) return true;
  }
  return false;
}

/** Feed stories not yet covered and not too old — newest first, at most one per slot. */
export function uncoveredStories(tenant, stories, { from = new Date(), daily = dailyConfig(tenant) } = {}) {
  const covered = coveredStories(tenant.slug);
  const cutoff = from.getTime() - daily.maxAgeHours * 3600_000;
  return stories
    .filter((s) => !storyCovered(s, covered))
    .filter((s) => !s.date || Date.parse(s.date) >= cutoff)
    .slice(0, daily.slots.length);
}

/**
 * The next `count` slot times after `from`, within `horizonH` hours, that hold none of our
 * scheduled posts. Every run starts from the same "next slot": without the taken set, each
 * story a later run finds would pile onto that one slot. Past the horizon a story waits —
 * news scheduled days out is stale by the time it airs, so it is better left to age out.
 */
export function freeSlotTimes(slots, tz, { from = new Date(), taken = new Set(), count = slots.length, horizonH = 24 } = {}) {
  const offsetMs = Date.parse("2000-01-01T00:00:00Z") - Date.parse(`2000-01-01T00:00:00${tz}`);
  const end = from.getTime() + horizonH * 3600_000;
  const candidates = [];
  for (let day = 0; day <= Math.ceil(horizonH / 24) + 1; day++) {
    const localDate = new Date(from.getTime() + offsetMs + day * 86400_000).toISOString().slice(0, 10);
    for (const slot of slots) candidates.push(Date.parse(`${localDate}T${slot.length === 5 ? `${slot}:00` : slot}${tz}`));
  }
  return [...new Set(candidates)].sort((a, b) => a - b)
    .filter((at) => at > from.getTime() && at <= end && !taken.has(at))
    .slice(0, count)
    .map((at) => new Date(at).toISOString());
}

/** Slot times (ms) already holding one of our live scheduled posts. */
export function takenSlots(slug) {
  return new Set(livePosts(slug).filter((r) => r.scheduledAt).map((r) => Date.parse(r.scheduledAt)));
}

/**
 * One full turn of the loop. `produceImpl`/`client`/`fetchImpl`/`spawnImpl` are injectable
 * for tests; `dryRun` scaffolds and validates without rendering or posting.
 */
export async function runDaily(tenant, {
  from = new Date(), fetchImpl, spawnImpl, produceImpl, client, log = () => {}, dryRun = false,
} = {}) {
  const daily = dailyConfig(tenant);
  const stories = await fetchStories(tenant, { fetchImpl });
  const times = freeSlotTimes(daily.slots, daily.tz, { from, taken: takenSlots(tenant.slug) });
  const todo = uncoveredStories(tenant, stories, { from, daily }).slice(0, times.length);
  const report = { tenant: tenant.slug, storiesInFeed: stories.length, slots: daily.slots, tz: daily.tz, planned: [], errors: [] };
  if (!todo.length) return report;

  const version = loadConfig().hyperframesVersion;
  for (let i = 0; i < todo.length; i++) {
    const story = todo[i];
    const at = times[i];
    try {
      let name, campaign;
      try {
        const made = await createStoryCampaign(tenant, { story, fetchImpl, spawnImpl, write: !dryRun });
        name = made.name;
        // saveCampaign strips name/dir from what createStoryCampaign returns: reload from disk
        campaign = dryRun ? made.campaign : loadCampaign(tenant.slug, name);
      } catch (error) {
        // a campaign left over from a crashed run (created but never posted): reuse it as-is
        const m = /campaign (.+?) already exists/.exec(error.message);
        if (!m || dryRun) throw error;
        name = m[1];
        campaign = loadCampaign(tenant.slug, name);
        log(`↺ reusing unfinished campaign ${name}`);
      }
      log(`→ campaign ${name} (${story.title.slice(0, 60)})`);
      const manifest = await (produceImpl || produce)({
        tenant, campaign, variants: resolveVariants(campaign, ["reel"]),
        version, log, dryRun,
      });
      if (dryRun) {
        report.planned.push({ campaign: name, title: story.title, storySlug: story.slug, scheduledAt: at, posts: [], dryRun: true });
        continue;
      }
      const reel = manifest.outputs?.reel;
      if (!reel?.video || !existsSync(reel.video)) throw new Error(`no rendered reel for ${name}`);
      const results = await publishCampaign({
        tenant, campaign, live: true, scheduledAt: at, only: daily.only,
        client: client || createClient(), log, dryRun,
      });
      report.planned.push({
        campaign: name, title: story.title, storySlug: story.slug, scheduledAt: at,
        posts: results.map((r) => ({ kind: r.kind, postId: r.post?.id || null })),
      });
    } catch (error) {
      report.errors.push(`${story.slug}: ${error.message}`);
    }
  }
  return report;
}
