/**
 * The weekly events reel, published: `ziggy events <slug> --week --publish`.
 *
 * The reel goes out live, now, to the tenant's reel platforms (`tenant.daily.only`, the kinds
 * the campaign defines) through `publishCampaign`, so every post lands in posts.jsonl like a
 * round's. Facebook passes the same Page guard as a round (fbguard.mjs: daily cap, gap, the
 * pause after a Meta 368) and is held when the guard says no; Instagram goes out anyway. A
 * platform that already has a live post of this campaign in posts.jsonl is never published
 * again, so a re-run cannot double-post. The reel must pass the round's check (rendered, audio,
 * loudness, length) before anything goes out: nobody looks at it first.
 */
import { dailyConfig, livePosts } from "./daily.mjs";
import { fbAllowed, fbGuardConfig, lastSpamBlock } from "./fbguard.mjs";
import { createClient } from "./postproxy.mjs";
import { POST_KINDS, publishCampaign } from "./publish.mjs";
import { activeKinds, checkReel, localDay, localLabel } from "./round.mjs";

const PLATFORM_NAMES = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", twitter: "X", threads: "Threads", bluesky: "Bluesky", linkedin: "LinkedIn" };
const platformName = (kind) => PLATFORM_NAMES[POST_KINDS[kind]?.platform] || kind;
const firstLine = (error) => String(error?.message || error).split("\n")[0];

/** The kinds the reel goes to: the tenant's `daily.only` that the campaign defines, in that order. */
export function reelKinds(tenant, campaign) {
  const posts = campaign.posts || {};
  return dailyConfig(tenant).only.filter((k) => POST_KINDS[k] && posts[k] && posts[k].enabled !== false);
}

/** This campaign's live posts in posts.jsonl (deleted ones excluded), one id per platform. */
export function publishedPlatforms(slug, name) {
  const out = {};
  for (const r of livePosts(slug)) if (r.campaign === name && r.live && r.platform && !out[r.platform]) out[r.platform] = r.postId;
  return out;
}

/**
 * What `--publish` does now, per kind: `publish`, `already` (with its postId), `held` (the
 * Facebook guard's reason: disabled, pause, gap, cap) or `down` (no active profile). Reads
 * posts.jsonl and Postproxy only; with everything already out it reads Postproxy not at all.
 */
export async function planWeekPublish(tenant, campaign, { client = createClient(), now = new Date() } = {}) {
  const t0 = now.getTime();
  const kinds = reelKinds(tenant, campaign);
  const done = publishedPlatforms(tenant.slug, campaign.name);
  const items = kinds.map((kind) => {
    const postId = done[POST_KINDS[kind].platform];
    return postId ? { kind, status: "already", postId } : { kind, status: "publish" };
  });
  const todo = items.filter((i) => i.status === "publish");
  let facebook = null;
  if (!todo.length) return { kinds, items, facebook };

  const { kinds: up, down } = await activeKinds(tenant, { only: todo.map((i) => i.kind) }, client);
  for (const i of todo) {
    if (up.includes(i.kind)) continue;
    const d = down.find((x) => x.startsWith(`${i.kind} (`));
    Object.assign(i, { status: "down", reason: d ? d.slice(i.kind.length + 2, -1) : "no profile" });
  }

  const fbTodo = todo.filter((i) => i.status === "publish" && POST_KINDS[i.kind].platform === "facebook");
  if (fbTodo.length) {
    const cfg = fbGuardConfig(tenant);
    const tz = dailyConfig(tenant).tz;
    // every Facebook post out or queued: a round's (scheduledAt) and one that went out at once (at)
    const fbRows = livePosts(tenant.slug).filter((r) => r.platform === "facebook" && (r.live || r.scheduledAt));
    const fbTimes = fbRows.map((r) => Date.parse(r.scheduledAt || r.at || "")).filter(Number.isFinite);
    const blockedAt = cfg.enabled ? await lastSpamBlock(fbRows, client, { now: t0 }) : null;
    facebook = {
      blockedAt: blockedAt ? new Date(blockedAt).toISOString() : null,
      pausedUntil: blockedAt ? new Date(blockedAt + cfg.pauseMs).toISOString() : null,
      maxPerDay: cfg.maxPerDay, minGapMinutes: cfg.minGapMs / 60_000,
    };
    for (const i of fbTodo) {
      const gate = fbAllowed(t0, { fbTimes, blockedAt, cfg, dayOf: (ms) => localDay(ms, tz) });
      if (gate.ok) fbTimes.push(t0);
      else Object.assign(i, { status: "held", reason: gate.reason });
    }
  }
  return { kinds, items, facebook };
}

/**
 * Plan, check the reel, then publish each kind on its own (a failure on one platform never
 * loses the other's post). `dryRun` stops after the plan. `ok` is false when a platform failed
 * or its profile is down; a Facebook post held by the guard is not a failure.
 */
export async function publishWeek(tenant, campaign, { client = createClient(), now = new Date(), dryRun = false, log = () => {} } = {}) {
  const plan = await planWeekPublish(tenant, campaign, { client, now });
  const todo = plan.items.filter((i) => i.status === "publish");
  let check = null;
  if (!dryRun && todo.length) {
    check = checkReel(tenant.slug, campaign.name);
    if (!check.ok) for (const i of todo) Object.assign(i, { status: "error", reason: `reel ${check.problems.join(", ")}` });
  }
  for (const i of todo) {
    if (dryRun || i.status !== "publish") continue;
    try {
      const [r] = await publishCampaign({ tenant, campaign, live: true, publishedAt: now.toISOString(), only: [i.kind], client, log });
      Object.assign(i, { status: "published", postId: r.post.id, postStatus: r.post.status || null });
    } catch (error) {
      Object.assign(i, { status: "error", reason: firstLine(error) });
    }
  }
  const ok = plan.kinds.length > 0 && plan.items.every((i) => !["down", "error"].includes(i.status));
  return { ...plan, dryRun, check, ok };
}

const hours = (minutes) => Math.round(minutes / 6) / 10;

function heldReason(reason, fb, tz, t0) {
  if (reason === "pause") return `blocco anti-spam di Meta (errore 368), Facebook in pausa fino alle ${localLabel(Date.parse(fb.pausedUntil), tz, t0)}`;
  if (reason === "gap") return `un altro post Facebook a meno di ${hours(fb.minGapMinutes)} ore`;
  if (reason === "cap") return `già ${fb.maxPerDay} post Facebook oggi (max ${fb.maxPerDay} al giorno)`;
  if (reason === "disabled") return "Facebook disattivato in tenant.json (daily.facebook)";
  return reason;
}

/** The Italian summary for the owner (and the report hook): one line, every platform with its outcome. */
export function weekPublishText(tenant, label, res, { now = new Date() } = {}) {
  const tz = dailyConfig(tenant).tz;
  const head = `🗓️ ${tenant.name} · Eventi della settimana ${label}${res.dryRun ? " (prova, niente pubblicato)" : ""}`;
  if (!res.items.length) return `${head}: nessuna piattaforma per il reel (tenant.json → daily.only)`;
  const part = (i) => {
    const p = platformName(i.kind);
    if (i.status === "published") return `${p} (id ${i.postId})`;
    if (i.status === "already") return `${p} (già pubblicato, id ${i.postId})`;
    if (i.status === "held") return `${p} (in attesa: ${heldReason(i.reason, res.facebook, tz, now.getTime())})`;
    if (i.status === "down") return `${p} (non pubblicato: ricollega il profilo su Postproxy, stato ${i.reason})`;
    if (i.status === "error") return `${p} (errore: ${i.reason})`;
    return p;
  };
  const out = res.items.some((i) => i.status === "published" || i.status === "already" || (res.dryRun && i.status === "publish"));
  const lead = res.dryRun ? "reel da pubblicare su" : out ? "reel pubblicato su" : "reel non pubblicato:";
  return `${head}: ${lead} ${res.items.map(part).join(", ")}`;
}

/** One line per platform for the operator, in English like the rest of the CLI output. */
export function weekPublishLines(res) {
  const what = (i) => ({
    published: `published live → ${i.postId}`,
    already: `already published (${i.postId})`,
    held: `held by the Facebook guard (${i.reason})`,
    down: `not published: profile not active on Postproxy (${i.reason})`,
    error: `not published: ${i.reason}`,
    publish: res.dryRun ? "would publish live now" : "not published",
  })[i.status];
  return res.items.map((i) => `  ${i.kind.padEnd(15)} ${what(i)}`);
}
