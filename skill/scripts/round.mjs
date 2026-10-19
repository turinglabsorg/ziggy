/**
 * A publishing round, the same every time.
 *
 *   ziggy round <slug> --plan [--archive]                 the stories still to do, with their deadline
 *   ziggy round <slug> --points <file|-> [--dry-run] [--notify]
 *
 * The operator's only input is the points file: `{ "<slug prefix>": ["point", …], "skip":
 * ["<slug prefix>", …] }`. Everything else is fixed: each story becomes a campaign with the next
 * jingle in rotation, renders, and goes through the check (rendered, audio track, loudness,
 * length). The good ones are scheduled, nearest deadline first, into the next free times on every
 * active platform. The tenant's rules come from `tenant.json → daily`:
 *
 *   "freshness": "next-day"   a story goes out at the latest the day after its date (local news)
 *              | "archive"    no deadline: fresh stories first, then the archive
 *   "round": { "times": ["08:00", …], "gapMinutes": 55 }
 *                             the local times a post may take, and the minimum distance from
 *                             any post already queued
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCampaign, rendersDir, saveCampaign } from "./config.mjs";
import { campaignFromStory, campaignNameFor, fetchStories, slugify } from "./story.mjs";
import { coveredStories, dailyConfig, livePosts, storyCovered, storyIdFromSlug } from "./daily.mjs";
import { nextJingle } from "./music.mjs";
import { POST_KINDS, publishCampaign } from "./publish.mjs";
import { createClient } from "./postproxy.mjs";
import { dropQueuedFacebook, fbAllowed, fbGuardConfig, lastSpamBlock, queuedInPause } from "./fbguard.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "index.js");

/** Summary points: 3 or 4 short facts (the skill's rules say how to write them). */
export const POINT_RULES = { min: 3, max: 4, maxChars: 90 };
/** A reel shorter than this did not render its story. */
const MIN_SECONDS = 10;
/** Mean loudness below this is a silent or broken track. */
const MIN_MEAN_DB = -40;
const SCHEDULE_DAYS = 7;

export function roundConfig(tenant) {
  const d = dailyConfig(tenant);
  const r = tenant.daily?.round || {};
  return {
    ...d,
    freshness: tenant.daily?.freshness === "archive" ? "archive" : "next-day",
    times: Array.isArray(r.times) && r.times.length ? r.times.map(String) : d.slots,
    gapMs: (Number(r.gapMinutes) || 60) * 60_000,
  };
}

const isIANATz = (tz) => tz && !tz.startsWith("+") && !tz.startsWith("-") && tz !== "Z";

/**
 * Get UTC offset in milliseconds for a timezone at a specific time.
 * Supports both fixed offsets ("+02:00", "Z") and IANA names ("Europe/Rome").
 */
export const offsetOf = (tz, atMs = Date.parse("2000-01-01T00:00:00Z")) => {
  if (isIANATz(tz)) {
    // IANA timezone: use Intl to get DST-correct offset
    const utcDate = new Date(atMs);
    const tzDate = new Date(utcDate.toLocaleString("en-US", { timeZone: tz }));
    const utcMs = Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate(), 
                           utcDate.getUTCHours(), utcDate.getUTCMinutes(), utcDate.getUTCSeconds());
    const tzMs = Date.UTC(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate(),
                          tzDate.getHours(), tzDate.getMinutes(), tzDate.getSeconds());
    return tzMs - utcMs;
  }
  // Fixed offset: "+02:00", "-05:00", "Z"
  return Date.parse("2000-01-01T00:00:00Z") - Date.parse(`2000-01-01T00:00:00${tz}`);
};

/**
 * Get the local date (YYYY-MM-DD) at a given UTC timestamp in a timezone.
 * Supports both fixed offsets and IANA names with DST.
 */
export const localDay = (ms, tz) => {
  if (isIANATz(tz)) {
    return new Date(ms).toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).slice(0, 10);
  }
  return new Date(ms + offsetOf(tz)).toISOString().slice(0, 10);
};

/**
 * Parse a local time (day + HH:MM) in a timezone to UTC milliseconds.
 * Supports both fixed offsets and IANA names with DST.
 */
export const localAt = (day, hm, tz) => {
  const time = hm.length === 5 ? `${hm}:00` : hm;
  if (isIANATz(tz)) {
    // IANA timezone: parse in local time, then convert to UTC
    const localStr = `${day}T${time}`;
    const localDate = new Date(localStr);
    // Get what this local time means in the target timezone
    const tzStr = new Date(localStr).toLocaleString("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", 
                                                                 hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const [datePart, timePart] = tzStr.split(", ");
    const [month, dayPart, year] = datePart.split("/");
    const [hour, minute, second] = timePart.split(":");
    const tzDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(dayPart), parseInt(hour), parseInt(minute), parseInt(second)));
    // Now compute the UTC time that corresponds to the desired local time
    const [localHour, localMinute, localSecond] = time.split(":").map(Number);
    const desiredLocal = Date.UTC(parseInt(day.slice(0, 4)), parseInt(day.slice(5, 7)) - 1, parseInt(day.slice(8, 10)), 
                                   localHour, localMinute, localSecond || 0);
    const offset = offsetOf(tz, desiredLocal);
    return desiredLocal - offset;
  }
  // Fixed offset
  return Date.parse(`${day}T${time}${tz}`);
};
/** "16:00" today, "13/10 09:00" on another day — the operator reads local time. */
function localLabel(ms, tz, now) {
  if (isIANATz(tz)) {
    const iso = new Date(ms).toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", 
                                                        hour: "2-digit", minute: "2-digit", hour12: false }).replace(", ", "T");
    const [date, time] = iso.split("T");
    return localDay(ms, tz) === localDay(now, tz) ? time : `${date.slice(8, 10)}/${date.slice(5, 7)} ${time}`;
  }
  const iso = new Date(ms + offsetOf(tz, ms)).toISOString();
  return localDay(ms, tz) === localDay(now, tz) ? iso.slice(11, 16) : `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

/** The last moment a story may go out: the end of the day after its date ("next-day"), or never. */
export function storyDeadline(cfg, date) {
  if (cfg.freshness === "archive" || !date) return Infinity;
  return localAt(localDay(Date.parse(date) + 86400_000, cfg.tz), "23:59", cfg.tz);
}

async function feedStories(tenant, fetchImpl) {
  // a round sees the whole feed, not just the latest few
  const url = tenant.feed?.url;
  const wide = url ? { ...tenant, feed: { ...tenant.feed, url: url.replace(/limit=\d+/, "limit=100") } } : tenant;
  return fetchStories(wide, fetchImpl ? { fetchImpl } : {});
}

/** Stories not covered (by a live post or a skipped campaign) that can still go out, oldest first. */
export async function planRound(tenant, { fetchImpl, now = new Date(), archive = false } = {}) {
  const cfg = roundConfig(tenant);
  const t0 = now.getTime();
  const placeNames = cfg.placeNames || [];
  const covered = coveredStories(tenant.slug, placeNames);
  const stories = (await feedStories(tenant, fetchImpl)).filter((s) => !storyCovered(s, covered, placeNames));
  return stories
    .map((s) => {
      const deadline = storyDeadline(cfg, s.date);
      return { prefix: s.slug.slice(0, 40), date: s.date, deadline: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null, section: s.section, sources: s.sources, image: Boolean(s.image), title: s.title, dek: s.dek };
    })
    .filter((s) => {
      // For archive mode: include stories with deadlines that haven't passed yet, or non-expiring stories
      if (archive) {
        return s.deadline ? Date.parse(s.deadline) > t0 + 30 * 60_000 : true;
      }
      // For non-archive: only stories with deadlines not yet passed, or very recent stories without deadlines
      return s.deadline ? Date.parse(s.deadline) > t0 + 30 * 60_000 : Date.parse(s.date) > t0 - 72 * 3600_000;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Problems with one story's points, or [] when they follow POINT_RULES. */
export function pointProblems(points) {
  if (!Array.isArray(points) || points.length < POINT_RULES.min || points.length > POINT_RULES.max) return [`${POINT_RULES.min}–${POINT_RULES.max} points expected`];
  const out = [];
  points.forEach((p, i) => {
    if (typeof p !== "string" || !p.trim()) out.push(`point ${i + 1} is empty`);
    else if (p.trim().length > POINT_RULES.maxChars) out.push(`point ${i + 1} is ${p.trim().length} characters (max ${POINT_RULES.maxChars})`);
  });
  return out;
}

/**
 * Points file → campaigns. A story is refused (never rendered) when it is not in the feed, is
 * already covered, has no photo, is past its deadline, or its points break the rules. Nothing is
 * written under `write: false`, not even the jingle rotation.
 * 
 * Points file format:
 * {
 *   "story-prefix": [3-4 points],
 *   "skip": ["prefix"],
 *   "casefile": [
 *     { "headline": "...", "dek": "...", "points": [confirmed, notConfirmed, whyMatters], "source": { "outlet": "...", "url": "..." },
 *       "link": "https://…" }   // optional: replaces the site URL in the caption CTA and the X thread's last reply
 *   ]
 * }
 */
export async function campaignsFromPoints(tenant, points, { fetchImpl, now = new Date(), write = true } = {}) {
  const cfg = roundConfig(tenant);
  const { skip = [], casefile: casefileItems = [], ...byPrefix } = points || {};
  if (!Array.isArray(skip)) throw new Error(`"skip" must be a list of slug prefixes`);
  if (!Array.isArray(casefileItems)) throw new Error(`"casefile" must be an array of case file items`);
  const stories = await feedStories(tenant, fetchImpl);
  const covered = coveredStories(tenant.slug);
  const out = { made: [], skipped: [], refused: [], casefiles: [] };
  
  // Process regular stories
  for (const [prefix, pts] of [...Object.entries(byPrefix), ...skip.map((p) => [p, null])]) {
    const story = stories.find((s) => s.slug.startsWith(prefix));
    const refuse = (reason) => out.refused.push({ prefix, title: story?.title || null, reason });
    if (!story) { refuse("not in the feed"); continue; }
    if (storyCovered(story, covered)) { refuse("already covered"); continue; }
    const name = campaignNameFor(tenant, story);
    if (pts === null) {
      const campaign = campaignFromStory(tenant, story);
      campaign.skip = true;
      if (write) saveCampaign(tenant.slug, name, campaign);
      out.skipped.push({ name, title: story.title });
      continue;
    }
    const problems = pointProblems(pts);
    if (problems.length) { refuse(problems.join("; ")); continue; }
    if (!story.image) { refuse("no photo in the feed"); continue; }
    if (storyDeadline(cfg, story.date) <= now.getTime() + 10 * 60_000) { refuse("past its deadline"); continue; }
    const campaign = campaignFromStory(tenant, story, { points: pts.map((p) => p.trim()) });
    if (write) {
      const jingle = nextJingle(tenant.slug);
      if (jingle) campaign.audio.jingle = jingle;
      saveCampaign(tenant.slug, name, campaign);
    }
    out.made.push({ name, title: story.title, campaign });
  }
  
  // Process case files (if tenant has them enabled)
  if (tenant.casefile?.enabled && casefileItems.length > 0) {
    const { campaignFromCasefile } = await import("./casefile.mjs");
    for (const item of casefileItems) {
      const refuse = (reason) => out.refused.push({ prefix: item.headline?.slice(0, 40) || "casefile", title: item.headline, reason });
      
      // Validate case file item
      if (!item.headline || !item.dek) { refuse("missing headline or dek"); continue; }
      if (!Array.isArray(item.points) || item.points.length !== 3) { refuse("case file requires exactly 3 points"); continue; }
      
      // Strip any leading labels from points before validation
      const stripLabel = (p) => String(p).trim().replace(/^(?:[✅❓•\-*]\s*)?(?:Confirmed|Not confirmed|Why it matters):\s*/i, "").trim();
      const cleanedPoints = item.points.map(stripLabel);
      
      if (cleanedPoints.some(p => !p || p.length > POINT_RULES.maxChars)) { 
        refuse("invalid points (empty or > 90 chars)"); 
        continue; 
      }
      if (!item.source?.outlet) { refuse("missing source outlet"); continue; }
      
      try {
        // Pass cleaned points to casefile (it will strip again but that's safe)
        const itemWithCleanedPoints = { ...item, points: cleanedPoints };
        const campaign = campaignFromCasefile(tenant, itemWithCleanedPoints);
        const name = `casefile-${(item.date || new Date().toISOString()).slice(0, 10)}-${slugify(item.headline).slice(0, 30)}`;
        if (write) {
          const jingle = nextJingle(tenant.slug);
          if (jingle) campaign.audio.jingle = jingle;
          saveCampaign(tenant.slug, name, campaign);
        }
        out.casefiles.push({ name, title: item.headline, campaign, at: item.at || null });
      } catch (error) {
        refuse(error.message);
      }
    }
  }
  
  return out;
}

/** Render each campaign's reel in its own CLI process, `concurrency` at a time. */
export async function renderAll(slug, names, { concurrency = 4, env = process.env } = {}) {
  // renders need no key: the children get none
  const childEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("POSTPROXY_API_KEY")));
  const results = new Array(names.length);
  let next = 0;
  async function worker() {
    while (next < names.length) {
      const i = next++;
      results[i] = await new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, "video", slug, names[i], "--variants", "reel"], { env: childEnv, stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        child.stderr.on("data", (d) => { err += d; });
        child.on("close", (code) => resolve({ name: names[i], ok: code === 0, error: code === 0 ? null : err.trim().split("\n").pop() || `exit ${code}` }));
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));
  return results;
}

/** A reel goes out only if it rendered, has an audible track, and a reel's length. */
export function checkReel(slug, name) {
  const manifestFile = join(rendersDir(slug, name), "manifest.json");
  let video = null;
  try { video = JSON.parse(readFileSync(manifestFile, "utf8")).outputs?.reel?.video || null; } catch { /* not rendered */ }
  if (!video || !existsSync(video)) return { ok: false, problems: ["not rendered"] };
  const ffprobe = process.env.ZIGGY_FFPROBE_BIN || "ffprobe";
  const ffmpeg = process.env.ZIGGY_FFMPEG_BIN || "ffmpeg";
  const probe = (args) => (spawnSync(ffprobe, ["-v", "error", ...args, video], { encoding: "utf8" }).stdout || "").trim();
  const seconds = Number(probe(["-show_entries", "format=duration", "-of", "csv=p=0"]));
  const audio = probe(["-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0"]) || null;
  const vol = spawnSync(ffmpeg, ["-nostdin", "-i", video, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" });
  const meanDb = Number(`${vol.stderr || ""}${vol.stdout || ""}`.match(/mean_volume:\s*(-?[\d.]+)/)?.[1] ?? NaN);
  const problems = [];
  if (!(seconds >= MIN_SECONDS)) problems.push(`length ${Number.isFinite(seconds) ? `${seconds.toFixed(1)}s` : "unknown"}`);
  if (!audio) problems.push("no audio");
  else if (!(meanDb > MIN_MEAN_DB)) problems.push(`audio too quiet (${Number.isFinite(meanDb) ? `${meanDb} dB` : "unmeasured"})`);
  return { ok: problems.length === 0, problems, video, seconds, audio, meanDb: Number.isFinite(meanDb) ? meanDb : null };
}

/** The kinds that can go out now: the profile behind each must be active on Postproxy. */
async function activeKinds(tenant, cfg, client) {
  const pinned = new Set(tenant.postproxy?.profileIds || []);
  const profiles = await client.listProfiles();
  const kinds = [], down = [];
  for (const kind of cfg.only) {
    const prof = profiles.find((p) => p.platform === POST_KINDS[kind]?.platform && (!pinned.size || pinned.has(p.id)));
    if (prof && (prof.status ?? "active") === "active") kinds.push(kind);
    else down.push(`${kind} (${prof ? prof.status : "no profile"})`);
  }
  return { kinds, down };
}

/**
 * Interleave news and case files according to tenant's ratio (e.g. 1:1, 2:1).
 * News is never dropped; case files fill remaining slots.
 * Returns ordered list ready for scheduling.
 */
export function interleaveNewsAndCasefiles(tenant, newsItems, casefileItems) {
  const cfg = tenant.casefile || {};
  const mode = cfg.mode || "fill"; // "fill" (original) or "alternate"
  
  if (mode === "fill" || !casefileItems.length) {
    // Original behavior: news first, then case files
    return [...newsItems, ...casefileItems];
  }
  
  // Alternate mode: interleave according to ratio
  const ratio = cfg.ratio || { news: 1, casefile: 1 };
  const newsRatio = Number(ratio.news) || 1;
  const casefileRatio = Number(ratio.casefile) || 1;
  
  const result = [];
  let newsIdx = 0;
  let casefileIdx = 0;
  
  // Interleave while both have items
  while (newsIdx < newsItems.length || casefileIdx < casefileItems.length) {
    // Add news items according to ratio
    for (let i = 0; i < newsRatio && newsIdx < newsItems.length; i++) {
      result.push(newsItems[newsIdx++]);
    }
    
    // Add case file items according to ratio
    for (let i = 0; i < casefileRatio && casefileIdx < casefileItems.length; i++) {
      result.push(casefileItems[casefileIdx++]);
    }
  }
  
  return result;
}

/**
 * Schedule campaigns into the next free times: nearest deadline first (then newest), one story
 * per time, at least gapMinutes from anything queued, never past a story's deadline.
 * Items with `at` (ISO time) are scheduled at that exact time; others get the next free slot.
 * `items` are `{ name, campaign, at? }`. The Facebook guard (fbguard.mjs) runs first: after a
 * 368 the Facebook-only posts queued inside the pause are deleted (`facebook.dropped`, or
 * `flagged` when the post is not Facebook-only), and a story gets one Facebook post at most.
 */
export async function scheduleRound(tenant, items, { client = createClient(), now = new Date(), dryRun = false } = {}) {
  const cfg = roundConfig(tenant);
  const t0 = now.getTime();
  const { kinds, down } = await activeKinds(tenant, cfg, client);
  const allLive = livePosts(tenant.slug);
  // Facebook Page guard (fbguard.mjs): fewer, spaced Facebook posts, none right after a 368,
  // and one Facebook post per story
  const fbKinds = kinds.filter((k) => POST_KINDS[k]?.platform === "facebook");
  const fbCfg = fbGuardConfig(tenant);
  const fbQueue = allLive.filter((r) => r.platform === "facebook" && r.scheduledAt);
  const fbBlockedAt = fbKinds.length && fbCfg.enabled ? await lastSpamBlock(fbQueue, client, { now: t0 }) : null;
  // the Facebook posts already queued inside the pause would fire into the block: off the queue
  const queued = queuedInPause(fbQueue, { now: t0, blockedAt: fbBlockedAt, pauseMs: fbCfg.pauseMs });
  const drop = queued.length ? await dropQueuedFacebook(tenant.slug, queued, client, { live: allLive, dryRun }) : { dropped: [], flagged: [], errors: [] };
  const gone = new Set(drop.dropped.map((d) => d.postId));
  const live = allLive.filter((r) => !gone.has(r.postId));
  const taken = live.map((r) => Date.parse(r.scheduledAt || "")).filter((t) => t > t0 - 3600_000);
  const fbRows = live.filter((r) => r.platform === "facebook");
  const fbTimes = fbRows.map((r) => Date.parse(r.scheduledAt || "")).filter(Number.isFinite);
  const storyIdOf = (name) => { try { return storyIdFromSlug(loadCampaign(tenant.slug, name).story?.slug); } catch { return null; } };
  const fbCampaigns = new Set(fbKinds.length ? fbRows.map((r) => r.campaign).filter(Boolean) : []);
  const fbStories = new Set([...fbCampaigns].map(storyIdOf).filter(Boolean));
  const facebook = { kinds: fbKinds, blockedAt: fbBlockedAt ? new Date(fbBlockedAt).toISOString() : null, pausedUntil: fbBlockedAt ? new Date(fbBlockedAt + fbCfg.pauseMs).toISOString() : null, maxPerDay: fbCfg.maxPerDay, minGapMinutes: fbCfg.minGapMs / 60_000, held: [], dropped: drop.dropped, flagged: drop.flagged, dropErrors: drop.errors };
  const candidates = [];
  for (let d = 0; d < SCHEDULE_DAYS; d++) for (const hm of cfg.times) candidates.push(localAt(localDay(t0 + d * 86400_000, cfg.tz), hm, cfg.tz));
  candidates.sort((a, b) => a - b);
  const deadlineOf = (it) => storyDeadline(cfg, it.campaign.story?.date);
  const ordered = [...items].sort((a, b) => deadlineOf(a) - deadlineOf(b) || String(b.campaign.story?.date || "").localeCompare(String(a.campaign.story?.date || "")));
  const results = [];
  for (const { name, campaign, at: itemAt } of ordered) {
    if (!kinds.length) { results.push({ name, error: "no active platform" }); continue; }
    
    let time;
    if (itemAt) {
      // Specific time requested: use it if valid
      time = Date.parse(itemAt);
      if (!time || time <= t0 + 10 * 60_000) {
        results.push({ name, error: `invalid or past 'at' time: ${itemAt}` });
        continue;
      }
    } else {
      // Next free slot logic
      const deadline = deadlineOf({ campaign });
      time = candidates.find((t) => t > t0 + 10 * 60_000 && t <= deadline && taken.every((x) => Math.abs(x - t) >= cfg.gapMs));
      if (!time) { results.push({ name, error: Number.isFinite(deadline) ? "no free time before its deadline" : "no free time" }); continue; }
    }
    
    taken.push(time);
    const at = new Date(time).toISOString();
    let itemKinds = kinds;
    if (fbKinds.length) {
      const storyId = storyIdFromSlug(campaign.story?.slug);
      const gate = fbCampaigns.has(name) || (storyId && fbStories.has(storyId))
        ? { ok: false, reason: "duplicate" }
        : fbAllowed(time, { fbTimes, blockedAt: fbBlockedAt, cfg: fbCfg, dayOf: (ms) => localDay(ms, cfg.tz) });
      if (gate.ok) { fbTimes.push(time); fbCampaigns.add(name); if (storyId) fbStories.add(storyId); }
      else { itemKinds = kinds.filter((k) => !fbKinds.includes(k)); facebook.held.push({ name, at, reason: gate.reason }); }
    }
    const row = { name, at, local: localLabel(time, cfg.tz, t0), kinds: itemKinds };
    if (!itemKinds.length) { results.push({ ...row, error: "no platform left after the Facebook guard" }); continue; }
    if (dryRun) { results.push({ ...row, dryRun: true }); continue; }
    try {
      const posts = await publishCampaign({ tenant, campaign: { ...campaign, name }, live: true, scheduledAt: at, only: itemKinds, client });
      results.push({ ...row, posts: posts.map((p) => p.post?.id).filter(Boolean) });
    } catch (error) {
      results.push({ ...row, error: String(error.message).split("\n")[0] });
    }
  }
  return { kinds, down, results, facebook };
}

const short = (name) => String(name || "").replace(/^story-\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
const fbPost = (p) => `Facebook ${p.postId}${p.campaign ? ` (${short(p.campaign)})` : ""}`;

/**
 * The whole round: points → campaigns → renders → checks → schedule, and the summary for the
 * operator. `dryRun` writes, renders and posts nothing: it shows where each story would go.
 */
export async function runRound(tenant, points, { fetchImpl, client = createClient(), now = new Date(), dryRun = false, concurrency = 4, log = () => {} } = {}) {
  const cfg = roundConfig(tenant);
  const created = await campaignsFromPoints(tenant, points, { fetchImpl, now, write: !dryRun });
  const totalMade = created.made.length + (created.casefiles?.length || 0);
  log(`round: ${totalMade} to publish (${created.made.length} stories, ${created.casefiles?.length || 0} case files), ${created.skipped.length} skipped, ${created.refused.length} refused`);
  for (const r of created.refused) log(`round: ✗ ${r.prefix} — ${r.reason}`);

  // Combine stories and case files for rendering
  const allItems = [...created.made, ...(created.casefiles || [])];
  
  let checked;
  if (dryRun) checked = allItems.map((m) => ({ name: m.name, ok: true, problems: [] }));
  else {
    const rendered = await renderAll(tenant.slug, allItems.map((m) => m.name), { concurrency });
    checked = rendered.map((r) => (r.ok ? { name: r.name, ...checkReel(tenant.slug, r.name) } : { name: r.name, ok: false, problems: [`render failed: ${r.error}`] }));
    for (const c of checked) log(`round: ${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? ` ${c.seconds?.toFixed(1)}s ${c.audio} ${c.meanDb} dB` : ` — ${c.problems.join(", ")}`}`);
  }
  
  // Separate good news and case files for interleaving
  const goodNews = created.made.filter((m) => checked.find((c) => c.name === m.name)?.ok)
    .map((m) => ({ name: m.name, campaign: dryRun ? m.campaign : loadCampaign(tenant.slug, m.name), type: 'news' }));
  const goodCasefiles = (created.casefiles || []).filter((m) => checked.find((c) => c.name === m.name)?.ok)
    .map((m) => ({ name: m.name, campaign: dryRun ? m.campaign : loadCampaign(tenant.slug, m.name), type: 'casefile', at: m.at }));
  
  // Interleave according to tenant config
  const interleaved = interleaveNewsAndCasefiles(tenant, goodNews, goodCasefiles);
  
  // with nothing new to schedule the round still looks at the Facebook queue (a 368 empties it)
  const scheduled = await scheduleRound(tenant, interleaved, { client, now, dryRun });
  const down = interleaved.length ? scheduled.down : [];
  const fb = scheduled.facebook;

  const ok = scheduled.results.filter((r) => !r.error).sort((a, b) => a.at.localeCompare(b.at));
  const problems = [
    ...created.refused.map((r) => `${r.title || r.prefix}: ${r.reason}`),
    ...checked.filter((c) => !c.ok).map((c) => `${short(c.name)}: ${c.problems.join(", ")}`),
    ...scheduled.results.filter((r) => r.error).map((r) => `${short(r.name)}: ${r.error}`),
    ...(fb?.flagged || []).map((f) => `${fbPost(f)}: in coda durante il blocco 368, non tolto perché è anche su ${f.platforms.join(", ")}`),
    ...(fb?.dropErrors || []).map((e) => `${fbPost(e)}: non tolto dalla coda (${e.error})`),
  ];
  
  const casefileMode = tenant.casefile?.mode || "fill";
  const modeNote = casefileMode === "alternate" ? ` (${tenant.casefile.ratio?.news || 1}:${tenant.casefile.ratio?.casefile || 1} news:casefile)` : "";
  
  const lines = [`🗓️ ${tenant.brand?.name || tenant.name} — giro delle ${localLabel(now.getTime(), cfg.tz, now.getTime())}${dryRun ? " (prova, niente pubblicato)" : ""}${modeNote}`];
  lines.push(ok.length
    ? `✅ ${ok.length} ${ok.length === 1 ? "programmato" : "programmati"} su ${scheduled.kinds.join(", ")}`
    : `✅ niente di nuovo da programmare`);
  for (const r of ok) lines.push(`   🕒 ${r.local} — ${short(r.name)}`);
  if (created.skipped.length) lines.push(`⤳ ${created.skipped.length} ${created.skipped.length === 1 ? "saltata" : "saltate"}: ${created.skipped.map((s) => short(s.name)).join(" · ")}`);
  if (created.casefiles?.length) lines.push(`📂 ${created.casefiles.length} case file ${created.casefiles.length === 1 ? "creato" : "creati"}${modeNote}`);
  for (const p of problems) lines.push(`✗ ${p}`);
  const pausedUntil = fb?.pausedUntil ? localLabel(Date.parse(fb.pausedUntil), cfg.tz, now.getTime()) : null;
  const held = (fb?.held || []).filter((h) => h.reason !== "duplicate");
  const twins = (fb?.held || []).length - held.length;
  if (held.length) {
    const why = pausedUntil && held.some((h) => h.reason === "pause")
      ? `blocco anti-spam di Meta (errore 368), Facebook in pausa fino alle ${pausedUntil}`
      : `limite Facebook: max ${fb.maxPerDay} al giorno, almeno ${Math.round(fb.minGapMinutes / 6) / 10} ore tra uno e l'altro`;
    lines.push(`📘 ${held.length} post solo su Instagram, senza Facebook (${why})`);
  }
  if (twins) lines.push(`📘 ${twins} ${twins === 1 ? "storia ha" : "storie hanno"} già il suo post Facebook: niente secondo post`);
  if (fb?.dropped?.length) {
    const n = fb.dropped.length;
    lines.push(`📘 ${n} post Facebook già in coda ${dryRun ? "da togliere" : n === 1 ? "tolto" : "tolti"} (blocco Meta 368, pausa fino alle ${pausedUntil}); Instagram resta`);
  }
  if (down.length) lines.push(`⚠️ non pubblicati su ${down.join(", ")}: ricollega il profilo su Postproxy`);
  return {
    text: lines.join("\n"),
    ok: problems.length === 0 && down.length === 0,
    scheduled: scheduled.results,
    kinds: scheduled.kinds,
    down,
    facebook: scheduled.facebook || null,
    skipped: created.skipped,
    refused: created.refused,
    checks: checked,
    casefiles: created.casefiles || [],
  };
}

/** The summary to the operator's Telegram (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in the environment). */
export async function notifyTelegram(text, { fetchImpl = fetch } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("--notify needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the environment");
  const base = process.env.ZIGGY_TELEGRAM_BASE_URL || "https://api.telegram.org";
  const res = await fetchImpl(`${base}/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }) });
  if (!res.ok) throw new Error(`Telegram sendMessage → ${res.status}`);
}
