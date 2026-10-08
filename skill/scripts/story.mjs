/**
 * Stories → campaigns. A tenant that publishes content declares where its stories come from
 * (tenant.json → `feed`), and `ziggy story <slug>` turns the latest one into a campaign on the
 * `story` template: kicker, headline, dek, meta line, link, hero image, and the posts to send.
 *
 *   "feed": {
 *     "url": "https://alienwatch.buzz/feed/v1/briefings?lang=en&limit=5",
 *     "items": "data",                                     // path to the array (optional: the body may be the array)
 *     "fields": { "title": "title", "dek": "dek", "section": "sector.name", "date": "storyDate",
 *                 "image": "imageUrl", "slug": "slug", "sources": "sourceCount", "languages": "languageCount" },
 *     "imageRewrite": { "match": "^.*?/api/assets/tenants/[0-9a-f-]+/", "replace": "https://alienwatch.buzz/assets/" },
 *     "storyUrl": "https://alienwatch.buzz/#/b/{slug}?lang=en",
 *     "displayUrl": "alienwatch.buzz"
 *   }
 *
 * Field paths are dotted (`sector.name`, `data.0.title`). Everything the mapping does not know
 * about is left for the human to fill in the generated campaign.json.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadCampaign, saveCampaign, tenantDir } from "./config.mjs";
import { composeThread } from "./thread.mjs";
import { SLIDE_IDS } from "./slides.mjs";

export function pick(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export async function fetchStories(tenant, { fetchImpl = fetch } = {}) {
  const feed = tenant.feed;
  if (!feed?.url) throw new Error(`tenant ${tenant.slug} has no feed configured (tenant.json → feed.url)`);
  const res = await fetchImpl(feed.url, { headers: { "User-Agent": "Mozilla/5.0 ziggy", Accept: "application/json" } });
  if (!res.ok) throw new Error(`feed ${feed.url} → ${res.status}`);
  const body = await res.json();
  const items = feed.items ? pick(body, feed.items) : body;
  if (!Array.isArray(items)) throw new Error(`feed did not return an array at ${feed.items || "root"}`);
  return items.map((it) => normalizeStory(it, feed));
}

export function normalizeStory(item, feed) {
  const f = feed.fields || {};
  const get = (k, fallback) => pick(item, f[k] ?? k) ?? fallback;
  let image = get("image", null);
  if (image && feed.imageRewrite?.match) image = String(image).replace(new RegExp(feed.imageRewrite.match), feed.imageRewrite.replace || "");
  const slug = get("slug", null) || slugify(get("title", "story"));
  const section = get("section", null);
  return {
    title: get("title", ""),
    dek: get("dek", ""),
    section: (feed.sections || {})[section] || section,
    date: get("date", null) || get("publishedAt", null),
    image,
    slug,
    sources: get("sources", null),
    languages: get("languages", null),
    url: feed.storyUrl ? feed.storyUrl.replace("{slug}", slug) : null,
    raw: item,
  };
}

export function slugify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);
}

/* ── AI summary (pre-script) ────────────────────────────────────────────────
 * The dek alone is too compressed to make a watchable reel: `ziggy story`
 * asks an agent to expand the story into 3–4 short slides that actually tell
 * the story. The agent is any command that reads a prompt on stdin and prints
 * lines; tenant.json → feed.agent (same shape as autopilot.agent, default
 * ["claude","-p","--output-format","json"]); feed.agent === null disables the
 * summary and falls back to splitting the dek into sentences. */

export const DEFAULT_STORY_AGENT = { command: ["claude", "-p", "--output-format", "json"], timeoutMs: 120000 };

export function storyAgent(tenant) {
  const a = tenant.feed?.agent;
  if (a === null || a === false) return null;
  return { ...DEFAULT_STORY_AGENT, ...(a || {}) };
}

/** The prompt handed to the agent. Pure, so tests can pin it. */
export function buildSummaryPrompt(tenant, story) {
  const lang = tenant.language || "en";
  return [
    lang === "it"
      ? `Riassumi questa notizia in 3-4 slide per un reel verticale. Ogni slide deve aggiungere un pezzo della storia (cosa è successo, chi, quando/dove, cosa comporta), non ripetere il titolo.`
      : `Summarise this story as 3-4 slides for a vertical reel. Each slide must add one piece of the story (what happened, who, when/where, what it means), not repeat the headline.`,
    lang === "it"
      ? `Regole: frasi brevi (max 90 caratteri l'una), italiano semplice, niente emoji, niente numerazione, una frase per slide.`
      : `Rules: short sentences (max 90 characters each), plain language, no emoji, no numbering, one sentence per slide.`,
    `Print ONLY the slides, one per line, nothing else.`,
    ``,
    `Headline: ${story.title}`,
    `Deck: ${story.dek}`,
  ].join("\n");
}

/** Parse the agent's reply into slide lines: strip list markers, quotes and blanks. */
export function parseSummaryLines(text) {
  const s = String(text || "");
  // `claude --output-format json` wraps the reply in {"result": "…"}: unwrap if valid
  try { const j = JSON.parse(s); if (typeof j.result === "string") return parseSummaryLines(j.result); } catch { /* plain text */ }
  return s.split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["'“”]+|["'“”]+$/g, "").trim())
    .filter((l) => l.length > 12 && l.length <= 140 && !/```/.test(l))
    .slice(0, 4);
}

/** Run the agent command with the prompt on stdin; return its stdout. */
export function askSummaryAgent(agent, prompt, { spawnImpl = spawnSync } = {}) {
  const [bin, ...args] = agent.command;
  const r = spawnImpl(bin, args, { input: prompt, encoding: "utf8", timeout: agent.timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ZIGGY_SUMMARY: "1" } });
  if (r.error) throw new Error(r.error.code === "ENOENT" ? `summary agent command not found: ${bin}` : r.error.message);
  if (r.status !== 0) throw new Error(`summary agent exited ${r.status}: ${(r.stderr || "").trim().slice(0, 400)}`);
  return String(r.stdout || "");
}

/**
 * The pre-script: ask the tenant's agent for summary slides. Falls back to the
 * deterministic dek split when there is no agent or the agent fails — a story
 * campaign must always come out.
 */
export async function summarizeStory(tenant, story, { spawnImpl } = {}) {
  const agent = storyAgent(tenant);
  if (!agent) return null;
  const lines = parseSummaryLines(askSummaryAgent(agent, buildSummaryPrompt(tenant, story), { spawnImpl }));
  return lines.length >= 2 ? lines : null;
}

/** Reel length: a fixed title read, one slow slide per point, a closing dek slide. */
export function storyDurationPointCount(points) {
  return Math.max(13, Math.round(5 + points.length * 4.4 + 4));
}

export function formatDate(iso, lang = "en") {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
  } catch { return iso.slice(0, 10); }
}

/** Build the campaign object for a story. Pass the AI summary slides via `points`. Pure. */
export function campaignFromStory(tenant, story, { name, points: summaryPoints } = {}) {
  const feed = tenant.feed || {};
  const lang = tenant.language || "en";
  const date = story.date ? story.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const campaignName = name || `story-${date}-${story.slug.split("-").slice(0, 4).join("-")}`.slice(0, 48).replace(/-+$/, "");
  const displayUrl = feed.displayUrl || (tenant.site ? new URL(tenant.site).hostname : "");
  const kicker = [story.section, formatDate(story.date, lang)].filter(Boolean).join(" · ");
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const metaWords = (kind) => (lang === "it" ? (kind === "source" ? ["fonte", "fonti"] : ["lingua", "lingue"]) : [kind, `${kind}s`]);
  const meta = [story.sources != null ? count(story.sources, ...metaWords("source")) : null, story.languages != null ? count(story.languages, ...metaWords("language")) : null].filter(Boolean).join(" · ");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const social = tenant.social || {};
  const sourcesPart = lang === "it" ? count(story.sources, "fonte", "fonti") : plural(story.sources, "report");
  const langsPart = story.languages ? (lang === "it" ? count(story.languages, "lingua", "lingue") : plural(story.languages, "language")) : null;
  const sourcesLine = story.sources != null
    ? lang === "it"
      ? ` Basato su ${sourcesPart}${langsPart ? ` in ${langsPart}` : ""}.`
      : ` Sourced from ${sourcesPart}${langsPart ? ` in ${langsPart}` : ""}.`
    : "";
  // the caption carries the full story link: Instagram captions are not clickable, but
  // whoever wants the sources copies the URL — no "comment LINK" DM round-trip
  const cta = (social.cta || "Full story with sources: {url}").replace("{url}", story.url).replace("{site}", displayUrl);
  const hashtags = (social.hashtags || "#UFO #UAP #Space #Astronomy").trim();
  // reel slides: the AI summary when present, else the dek split at sentence
  // ends, one point per slide (edit them in campaign.json)
  const points = summaryPoints?.length ? summaryPoints.slice(0, 4)
    : story.dek.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 12).slice(0, 4);
  // long caption: headline, dek, then the story told slide by slide — the caption should
  // carry the whole story, not make the reader leave Instagram to understand it
  const pointsBlock = points.length ? `\n\n${points.join("\n\n")}` : "";
  const caption = `${story.title}\n\n${story.dek}${pointsBlock}${sourcesLine}\n\n${cta}${hashtags ? `\n\n${hashtags}` : ""}`;
  const thread = composeThread({ title: story.title, dek: story.dek, url: story.url, limit: 280 });
  // tenant.social.platforms opts a tenant into extra kinds: ["tiktok", "instagram_post"] —
  // reels are always on, the X thread stays manual (it needs the slide-cover still)
  const extra = new Set(social.platforms || []);
  return {
    template: "story",
    language: lang,
    duration: storyDurationPointCount(points),
    intent: `Story reel: ${story.title}`,
    story: { slug: story.slug, url: story.url, date: story.date, section: story.section },
    copy: { kicker, headline: story.title, dek: story.dek, points, meta, sources: story.sources ?? null, url: displayUrl },
    image: story.image,
    // bed.mjs mood per tenant: "ambient" default, tenant.social.bed overrides (e.g. "news").
    audio: { bed: social.bed || "ambient", volume: 0.6, swellAt: 1.6, beats: [[0.6, 1318.5, 1.2, 0.07], [1.5, 659.3, 1.6, 0.06], [7.6, 987.8, 0.9, 0.035]] },
    posts: {
      instagram_reel: {
        body: caption,
        media: "reel",
        cover: true,
      },
      instagram_post: {
        body: caption,
        media: [...SLIDE_IDS],
        alt_text: [story.title, story.dek, `${tenant.name} — ${displayUrl}`].filter(Boolean),
        enabled: extra.has("instagram_post"),
      },
      twitter: {
        body: thread.body,
        media: "slide-cover",
        alt_text: story.title,
        thread: thread.thread,
        enabled: false,
      },
      // TikTok publishes the same reel. Postproxy defaults disable_comment to true,
      // so comments are turned on explicitly here.
      tiktok: {
        body: caption,
        media: "reel",
        platform: { privacy_status: "PUBLIC_TO_EVERYONE", disable_comment: false, disable_duet: true, disable_stitch: true },
        enabled: extra.has("tiktok"),
      },
    },
  };
}

/**
 * Write a story as a campaign: `story` when the caller already holds it (the daily loop — a
 * second feed read could return a different order), else the feed's N-th. Returns { name, dir, story }.
 */
export async function createStoryCampaign(tenant, { index = 0, story: given = null, name, fetchImpl, force = false, spawnImpl, summarize = true, write = true } = {}) {
  let story = given;
  if (!story) {
    const stories = await fetchStories(tenant, { fetchImpl });
    story = stories[index];
    if (!story) throw new Error(`the feed has ${stories.length} stor${stories.length === 1 ? "y" : "ies"}; index ${index} is out of range`);
  }
  const campaignName = name || campaignNameFor(tenant, story);
  let exists = false;
  try { loadCampaign(tenant.slug, campaignName); exists = true; } catch { /* new */ }
  if (exists && !force) throw new Error(`campaign ${campaignName} already exists for ${tenant.slug} — pass --force to overwrite`);
  // the AI summary of the story: one short slide per story beat, for the reel
  let points = null;
  if (summarize) {
    try { points = await summarizeStory(tenant, story, { spawnImpl }); }
    catch { points = null; /* a broken agent must not block the campaign */ }
  }
  const campaign = campaignFromStory(tenant, story, { name, points });
  if (!write) {
    // dry-run: the campaign exists only in memory, so a probe can never block the real run
    const dir = join(tenantDir(tenant.slug), "campaigns", campaignName);
    return { name: campaignName, dir, story, campaign: { ...campaign, name: campaignName, dir } };
  }
  const dir = saveCampaign(tenant.slug, campaignName, campaign);
  return { name: campaignName, dir, story, campaign };
}

function defaultName(tenant, story) {
  const date = story.date ? story.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `story-${date}-${story.slug.split("-").slice(0, 4).join("-")}`.slice(0, 48).replace(/-+$/, "");
}

/**
 * The default name unless a different story already holds it: headlines share their opening
 * words ("A Ragusa il quarto…"), and a clash would hand one story the other's campaign. The
 * same story re-slugged by the feed (new content hash) keeps its name.
 */
export function campaignNameFor(tenant, story) {
  const base = defaultName(tenant, story);
  const bare = (s) => String(s || "").replace(/(?:-[0-9a-f]{6,})+$/, "");
  let holder;
  try { holder = loadCampaign(tenant.slug, base).story?.slug ?? null; } catch { return base; }
  if (holder && bare(holder) === bare(story.slug)) return base;
  const tag = (story.slug.match(/[0-9a-f]{6,}/g) || []).pop()?.slice(0, 8) || slugify(story.title).split("-").slice(4, 6).join("-") || "2";
  return `${base}-${tag}`;
}
