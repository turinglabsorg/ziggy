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
 *     "displayUrl": "alienwatch.buzz",
 *     "detailUrl": "https://alienwatch.buzz/feed/v1/briefings/{slug}?lang=en"   // optional, see storyDetailUrl
 *   }
 *
 * Field paths are dotted (`sector.name`, `data.0.title`). Everything the mapping does not know
 * about is left for the human to fill in the generated campaign.json.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadCampaign, saveCampaign, tenantDir } from "./config.mjs";
import { pointsReport, storyCaption } from "./lint.mjs";
import { nextJingle } from "./music.mjs";
import { composeThread } from "./thread.mjs";
import { SLIDE_IDS } from "./slides.mjs";

export function pick(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export async function fetchStories(tenant, { fetchImpl = fetch, maxItems = 200 } = {}) {
  const feed = tenant.feed;
  if (!feed?.url) throw new Error(`tenant ${tenant.slug} has no feed configured (tenant.json → feed.url)`);
  
  const allItems = [];
  let cursor = null;
  let fetchCount = 0;
  const maxFetches = 10; // Safety limit to prevent infinite loops
  
  while (fetchCount < maxFetches && allItems.length < maxItems) {
    const url = cursor ? `${feed.url}&cursor=${encodeURIComponent(cursor)}` : feed.url;
    const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 ziggy", Accept: "application/json" } });
    if (!res.ok) throw new Error(`feed ${url} → ${res.status}`);
    
    const body = await res.json();
    const items = feed.items ? pick(body, feed.items) : body;
    if (!Array.isArray(items)) throw new Error(`feed did not return an array at ${feed.items || "root"}`);
    
    allItems.push(...items);
    fetchCount++;
    
    // Check for pagination: try common patterns (nextCursor, page.nextCursor, next, etc.)
    const nextCursor = body.page?.nextCursor || body.nextCursor || body.pagination?.nextCursor || body.next || null;
    if (!nextCursor || items.length === 0) break;
    cursor = nextCursor;
  }
  
  return allItems.slice(0, maxItems).map((it) => normalizeStory(it, feed));
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

/* ── Story body ─────────────────────────────────────────────────────────────
 * The list endpoint carries title and dek only; the article is on the per-story
 * endpoint (`{ data: { bodyHtml, … } }`). Points written from title and dek can
 * only retell them: the body is where the new facts are. */

/**
 * The feed's per-story URL: `feed.detailUrl` with `{slug}`, else the list URL's path + "/<slug>",
 * keeping only its `lang` (".../briefings?lang=it&limit=50" → ".../briefings/<slug>?lang=it").
 * Null without a slug or a feed URL. Pure.
 */
export function storyDetailUrl(tenant, slug) {
  const feed = tenant?.feed || {};
  if (!slug) return null;
  if (feed.detailUrl) return String(feed.detailUrl).replaceAll("{slug}", encodeURIComponent(slug));
  let url;
  try { url = new URL(feed.url); } catch { return null; }
  const lang = url.searchParams.get("lang");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(slug)}${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`;
}

const ENTITIES = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—", agrave: "à", egrave: "è", eacute: "é", igrave: "ì",
  ograve: "ò", ugrave: "ù", Agrave: "À", Egrave: "È",
};

function decodeEntity(entity, name) {
  if (name[0] !== "#") return ENTITIES[name] ?? entity;
  const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
}

/** Article HTML → plain text: tags off, entities decoded, a blank line between paragraphs. Pure. */
export function htmlToText(html) {
  const text = String(html ?? "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|section|article|figure|figcaption|table|tr|pre)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity);
  return text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
}

/** `text` up to `max` characters, cut after the last sentence end that fits (else the last word). */
export function clipAtSentence(text, max) {
  if (text.length <= max) return text;
  let cut = 0;
  for (const m of text.slice(0, max + 1).matchAll(/[.!?…]["'’”»)]*(?=\s)/g)) if (m.index + m[0].length <= max) cut = m.index + m[0].length;
  if (!cut) cut = text.lastIndexOf(" ", max) > 0 ? text.lastIndexOf(" ", max) : max;
  return text.slice(0, cut).trim();
}

/**
 * The story's article as plain text, cut at a sentence end within `maxChars`: the detail
 * endpoint's `data.bodyHtml` (or `bodyHtml` / `body` at the top). "" on any failure, never a
 * throw: the body only feeds the points, so a slow or broken endpoint must not stop a round.
 * A request that fails outright (a keep-alive socket the server already closed: "fetch failed")
 * is tried once more after `retryDelayMs`; an HTTP error or a timeout is not.
 */
export async function fetchStoryBody(tenant, story, { fetchImpl = fetch, maxChars = 2500, timeoutMs = 10_000, retryDelayMs = 500 } = {}) {
  try {
    const url = storyDetailUrl(tenant, story?.slug);
    if (!url) return "";
    const get = () => fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 ziggy", Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    let res;
    try {
      res = await get();
    } catch (err) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") return "";
      await new Promise((r) => setTimeout(r, retryDelayMs));
      res = await get();
    }
    if (!res.ok) return "";
    const json = await res.json();
    const html = [json?.data?.bodyHtml, json?.bodyHtml, json?.body].find((v) => typeof v === "string");
    return html ? clipAtSentence(htmlToText(html), maxChars) : "";
  } catch {
    return "";
  }
}

/* ── AI summary (pre-script) ────────────────────────────────────────────────
 * The dek alone is too compressed to make a watchable reel: `ziggy story`
 * asks an agent to expand the story into 3–4 short slides that actually tell
 * the story. The agent is any command that reads a prompt on stdin and prints
 * lines; tenant.json → feed.agent (same shape as autopilot.agent, default
 * ["claude","-p","--output-format","json"]); feed.agent === null disables the
 * summary, and the reel is the title slide and the close. Never the dek split
 * into slides: that is the dek told twice. */

export const DEFAULT_STORY_AGENT = { command: ["claude", "-p", "--output-format", "json"], timeoutMs: 120000 };

export function storyAgent(tenant) {
  const a = tenant.feed?.agent;
  if (a === null || a === false) return null;
  return { ...DEFAULT_STORY_AGENT, ...(a || {}) };
}

/**
 * The prompt handed to the agent. With the article (`story.body`) the slides take their facts
 * from it, preferring what the headline and deck do not say. Pure, so tests can pin it.
 */
export function buildSummaryPrompt(tenant, story) {
  const it = (tenant.language || "en") === "it";
  const body = String(story.body ?? "").trim();
  const task = body
    ? it
      ? `Riassumi questa notizia in 3-4 slide per un reel verticale, con i fatti dell'articolo. Preferisci i fatti che titolo e sommario (Headline, Deck) non dicono già: numeri, nomi, date, cosa succede dopo. La prima slide non ripete il titolo, nessuna ripete un'altra o il sommario.`
      : `Summarise this story as 3-4 slides for a vertical reel, told with facts from the article. Prefer facts NOT already in the headline or deck: numbers, names, dates, what happens next. Slide 1 does not repeat the headline, none repeats another or the deck.`
    : it
      ? `Riassumi questa notizia in 3-4 slide per un reel verticale. Ogni slide aggiunge un fatto nuovo (cosa è successo, chi, quando/dove, cosa comporta): la prima non ripete il titolo, nessuna ripete un'altra.`
      : `Summarise this story as 3-4 slides for a vertical reel. Each slide adds a new fact (what happened, who, when/where, what it means): the first does not repeat the headline, none repeats another.`;
  const caution = it
    ? `Solo fatti dell'articolo: non inventare nulla e mantieni le cautele della fonte ("avrebbe", "secondo").`
    : `Only facts from the article: invent nothing, and keep the source's hedges ("allegedly", "according to").`;
  return [
    task,
    it
      ? `Regole: frasi brevi (max 90 caratteri l'una), italiano semplice, niente emoji, niente numerazione, una frase per slide.`
      : `Rules: short sentences (max 90 characters each), plain language, no emoji, no numbering, one sentence per slide.`,
    ...(body ? [caution] : []),
    `Print ONLY the slides, one per line, nothing else.`,
    ``,
    `Headline: ${story.title}`,
    `Deck: ${story.dek}`,
    ...(body ? [`Article: ${body}`] : []),
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

/* ── Points: one filtered list for the reel and the caption ────────────────
 * The reel slides and the caption bullets are the same points: a point that
 * retells the headline, the dek or an earlier point is a repetition on a slide
 * as much as in the caption, so lint.mjs pointsReport drops it from both. */

/** At most this many points survive on the reel; the caption shows the first CAPTION_POINTS. */
export const REEL_POINTS = 4;
export const CAPTION_POINTS = 3;
/** Fewer points than this left after the filter: the agent is asked once for new ones. */
export const MIN_POINTS = 2;

/** The caption after the points: the sources line, the CTA with the story link, the hashtags. */
export function captionTail(tenant, story) {
  const feed = tenant.feed || {};
  const lang = tenant.language || "en";
  const social = tenant.social || {};
  const displayUrl = feed.displayUrl || (tenant.site ? new URL(tenant.site).hostname : "");
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const sourcesPart = lang === "it" ? count(story.sources, "fonte", "fonti") : plural(story.sources, "report");
  const langsPart = story.languages ? (lang === "it" ? count(story.languages, "lingua", "lingue") : plural(story.languages, "language")) : null;
  const sourcesLine = story.sources != null
    ? lang === "it"
      ? `Basato su ${sourcesPart}${langsPart ? ` in ${langsPart}` : ""}.`
      : `Sourced from ${sourcesPart}${langsPart ? ` in ${langsPart}` : ""}.`
    : "";
  // the caption carries the full story link: Instagram captions are not clickable, but
  // whoever wants the sources copies the URL — no "comment LINK" DM round-trip
  const cta = (social.cta || "Full story with sources: {url}").replace("{url}", story.url).replace("{site}", displayUrl);
  const hashtags = (social.hashtags || "#UFO #UAP #Space #Astronomy").trim();
  return `${sourcesLine ? `${sourcesLine}\n\n` : ""}${cta}${hashtags ? `\n\n${hashtags}` : ""}`;
}

/**
 * A story's points through the filter (lint.mjs pointsReport against its headline, dek and
 * caption tail): `kept` (at most REEL_POINTS, in order) go on the reel, the first CAPTION_POINTS
 * of them in the caption; `dropped` carries each reason. Pure.
 */
export function storyPoints(tenant, story, points) {
  return pointsReport(points, { title: story.title, dek: story.dek, tail: captionTail(tenant, story), max: REEL_POINTS });
}

const REJECTED_WHY = {
  en: { "no new words": "says nothing the headline and deck do not", title: "repeats the headline", dek: "repeats the deck", point: "repeats another slide", lint: "repeats the caption", max: "one too many" },
  it: { "no new words": "non dice nulla che titolo e sommario non dicano", title: "ripete il titolo", dek: "ripete il sommario", point: "ripete un'altra slide", lint: "ripete la didascalia", max: "una di troppo" },
};

/**
 * The second ask, when the first points did not survive the filter: the rejected ones with why,
 * and new slides with facts from the article that the headline and deck do not hold. Pure.
 */
export function buildRewritePrompt(tenant, story, rejected = []) {
  const it = (tenant.language || "en") === "it";
  const why = REJECTED_WHY[it ? "it" : "en"];
  const list = rejected.map((r) => `- ${r.point} (${why[r.reason] || r.reason})`);
  return [
    it
      ? `Queste slide per un reel verticale ripetono titolo o sommario (Headline, Deck) e sono state scartate:`
      : `These slides for a vertical reel repeat the headline or the deck and were rejected:`,
    ...(list.length ? list : [it ? "- (nessuna slide utilizzabile)" : "- (no usable slide)"]),
    ``,
    it
      ? `Riscrivile: 3-4 slide nuove con i fatti dell'articolo che titolo e sommario non dicono: numeri, nomi, date, cosa succede dopo. Non ripetere le slide scartate, il titolo o il sommario; nessuna slide ripete un'altra.`
      : `Rewrite them: 3-4 new slides with facts from the article that the headline and deck do not say: numbers, names, dates, what happens next. Do not repeat the rejected slides, the headline or the deck; no slide repeats another.`,
    it
      ? `Regole: frasi brevi (max 90 caratteri l'una), italiano semplice, niente emoji, niente numerazione, una frase per slide.`
      : `Rules: short sentences (max 90 characters each), plain language, no emoji, no numbering, one sentence per slide.`,
    it
      ? `Solo fatti dell'articolo: non inventare nulla e mantieni le cautele della fonte ("avrebbe", "secondo"). Se l'articolo non ha altri fatti, scrivi meno slide.`
      : `Only facts from the article: invent nothing, and keep the source's hedges ("allegedly", "according to"). If the article holds no other fact, write fewer slides.`,
    `Print ONLY the slides, one per line, nothing else.`,
    ``,
    `Headline: ${story.title}`,
    `Deck: ${story.dek}`,
    `Article: ${String(story.body ?? "").trim()}`,
  ].join("\n");
}

/**
 * `points` through the filter, and when fewer than MIN_POINTS survive, one rewrite by the agent
 * from the article (`story.body`, fetched when the story does not carry it), told which points
 * were rejected and why. The rewrite is filtered the same way, and the list that keeps more
 * points wins (the first on a tie). No agent, no article, or an agent that fails: the first list
 * stays — 0 or 1 points is a story with fewer slides, never a failure.
 * `{ points, kept, dropped, rewritten }`: `points` as given or as rewritten, before the filter.
 */
export async function rewriteThinPoints(tenant, story, points, { agent = storyAgent(tenant), spawnImpl, fetchImpl } = {}) {
  const first = storyPoints(tenant, story, points);
  const keep = { points: Array.isArray(points) ? points : [], ...first, rewritten: false };
  if (first.kept.length >= MIN_POINTS || !agent) return keep;
  const body = story.body ?? await fetchStoryBody(tenant, story, { fetchImpl });
  // the new facts can only come from the article: without one a rewrite retells title and dek
  if (!String(body || "").trim()) return keep;
  let lines;
  try { lines = parseSummaryLines(askSummaryAgent(agent, buildRewritePrompt(tenant, { ...story, body }, first.dropped), { spawnImpl })); }
  catch { return keep; }
  const second = storyPoints(tenant, story, lines);
  return second.kept.length > first.kept.length ? { points: lines, ...second, rewritten: true } : keep;
}

/**
 * The pre-script: ask the tenant's agent for summary slides, from the article body too (fetched
 * when the story does not carry one), and once more when fewer than MIN_POINTS survive the filter
 * (rewriteThinPoints). Null without an agent; a failing first ask throws, and createStoryCampaign
 * goes on without points — a story campaign must always come out.
 */
export async function summarizeStory(tenant, story, { spawnImpl, fetchImpl } = {}) {
  const agent = storyAgent(tenant);
  if (!agent) return null;
  const body = story.body ?? await fetchStoryBody(tenant, story, { fetchImpl });
  const lines = parseSummaryLines(askSummaryAgent(agent, buildSummaryPrompt(tenant, { ...story, body }), { spawnImpl }));
  return (await rewriteThinPoints(tenant, { ...story, body }, lines, { agent, spawnImpl })).points;
}

/**
 * Reel length: a fixed title read, one slow slide per point, the close. Never under 13 s: with
 * 0 or 1 point the close holds the rest (title 5 s, close 8 s; title, point and close 4–5 s each).
 */
export function storyDurationPointCount(points) {
  return Math.max(13, Math.round(5 + points.length * 4.4 + 4));
}

export function formatDate(iso, lang = "en") {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
  } catch { return iso.slice(0, 10); }
}

/**
 * Build the campaign object for a story. Pass the summary or the round's points via `points`:
 * they go through storyPoints, and only the kept ones are used. Pure.
 */
export function campaignFromStory(tenant, story, { name, points: given } = {}) {
  const feed = tenant.feed || {};
  const lang = tenant.language || "en";
  const date = story.date ? story.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const campaignName = name || `story-${date}-${story.slug.split("-").slice(0, 4).join("-")}`.slice(0, 48).replace(/-+$/, "");
  const displayUrl = feed.displayUrl || (tenant.site ? new URL(tenant.site).hostname : "");
  const kicker = [story.section, formatDate(story.date, lang)].filter(Boolean).join(" · ");
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const metaWords = (kind) => (lang === "it" ? (kind === "source" ? ["fonte", "fonti"] : ["lingua", "lingue"]) : [kind, `${kind}s`]);
  const meta = [story.sources != null ? count(story.sources, ...metaWords("source")) : null, story.languages != null ? count(story.languages, ...metaWords("language")) : null].filter(Boolean).join(" · ");
  const social = tenant.social || {};
  // one filtered list for the reel slides and the caption bullets: a point that retells the
  // headline, the dek or an earlier point says it twice on a slide as much as in the caption,
  // so it is in neither (copy.droppedPoints says why). The reel shows up to four, the caption
  // the first three as "•" lines; with none left the reel is title and close, and the caption
  // has no points paragraph. No points never means the dek split into slides: that is the dek
  const tail = captionTail(tenant, story);
  const { kept: points, dropped } = storyPoints(tenant, story, given);
  const shown = points.slice(0, CAPTION_POINTS);
  const caption = storyCaption({ title: story.title, dek: story.dek, points: shown, tail });
  const thread = composeThread({ title: story.title, dek: story.dek, url: story.url, limit: 280 });
  // tenant.social.platforms opts a tenant into extra kinds: ["tiktok", "instagram_post"] —
  // reels are always on; X (when listed) posts the same reel, which every round renders
  const extra = new Set(social.platforms || []);
  return {
    template: "story",
    language: lang,
    duration: storyDurationPointCount(points),
    intent: `Story reel: ${story.title}`,
    story: { slug: story.slug, url: story.url, date: story.date, section: story.section },
    copy: { kicker, headline: story.title, dek: story.dek, points, captionPoints: shown, droppedPoints: dropped, meta, sources: story.sources ?? null, url: displayUrl },
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
        media: "reel",
        alt_text: story.title,
        thread: thread.thread,
        enabled: extra.has("twitter"),
      },
      // TikTok publishes the same reel. Postproxy defaults disable_comment to true,
      // so comments are turned on explicitly here.
      tiktok: {
        body: caption,
        media: "reel",
        platform: { privacy_status: "PUBLIC_TO_EVERYONE", disable_comment: false, disable_duet: true, disable_stitch: true },
        enabled: extra.has("tiktok"),
      },
      // the same reel on the tenant's Facebook Page; links in the caption are clickable there
      facebook_reel: {
        body: caption,
        media: "reel",
        enabled: extra.has("facebook_reel"),
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
  // the AI summary of the story: one short slide per story beat; the ones that add a fact go on
  // the reel and in the caption
  let points = null;
  if (summarize) {
    try { points = await summarizeStory(tenant, story, { spawnImpl, fetchImpl }); }
    catch { points = null; /* a broken agent must not block the campaign */ }
  }
  const campaign = campaignFromStory(tenant, story, { name, points });
  if (!write) {
    // dry-run: the campaign exists only in memory, so a probe can never block the real run
    const dir = join(tenantDir(tenant.slug), "campaigns", campaignName);
    return { name: campaignName, dir, story, campaign: { ...campaign, name: campaignName, dir } };
  }
  // the next jingle in rotation, stamped so re-renders keep the same music
  const jingle = nextJingle(tenant.slug);
  if (jingle) campaign.audio.jingle = jingle;
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
