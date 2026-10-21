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
import { spawn } from "node:child_process";
import { join } from "node:path";
import { loadCampaign, saveCampaign, tenantDir } from "./config.mjs";
import { judgeConfig, judgePoints, judgeReason } from "./judge.mjs";
import { cleanPoint, pointsReport, storyCaption } from "./lint.mjs";
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
 * What a point can and cannot say: one text per language, in every prompt that writes or judges
 * points (the summary, the replacement, judge.mjs) and in SKILL.md, AGENTS.md,
 * docs/round-prompt-points.it.md and docs/punti-cosa-possono-dire.it.md.
 */
export const POINT_SPEC = {
  it: [
    "Cosa PUÒ dire un punto. Ogni punto porta almeno una di queste cose, sempre presa dall'articolo:",
    "- un numero, una cifra o una quantità;",
    "- un nome (persona, ente, luogo) che non è nel titolo né nel sommario;",
    "- una data, un orario o una scadenza;",
    "- una conseguenza;",
    "- un prossimo passo: cosa succede dopo;",
    "- una breve citazione o posizione attribuita (\"secondo…\", «…»);",
    "- un dettaglio concreto: la causa, il modo, dove esattamente.",
    "Cosa NON PUÒ dire:",
    "- il titolo, il sommario o un altro punto con altre parole (sinonimi, ordine diverso, lo stesso fatto detto in modo più o meno preciso);",
    "- commenti o giudizi generici (\"una vicenda importante\", \"resta da vedere\");",
    "- frasi sulle fonti (\"le fonti non dicono…\", \"non ci sono dettagli\"): non aggiungono fatti;",
    "- fatti che non sono nell'articolo: niente conoscenze esterne, niente deduzioni;",
    "- domande, emoji, hashtag, inviti all'azione.",
    "Mantieni le cautele della fonte (\"avrebbe\", \"secondo\").",
    "La prova: chi ha già letto titolo e sommario impara da questo punto qualcosa di nuovo e preciso? Se no, è una ripetizione.",
  ].join("\n"),
  en: [
    "What a point CAN say. Each point carries at least one of these, always taken from the article:",
    "- a number, an amount or a quantity;",
    "- a name (person, organisation, place) that is not in the headline or the deck;",
    "- a date, a time or a deadline;",
    "- a consequence;",
    "- a next step: what happens next;",
    "- a short attributed quote or position (\"according to…\", \"…\", X said);",
    "- a concrete detail: the cause, the method, where exactly.",
    "What a point CANNOT say:",
    "- the headline, the deck or another point in other words (synonyms, reordered, the same fact worded more or less specifically);",
    "- generic commentary or evaluation (\"an important case\", \"it remains to be seen\");",
    "- statements about the sources (\"the sources do not say…\", \"no details were given\"): they add no fact;",
    "- facts that are not in the article: no outside knowledge, no inference;",
    "- questions, emoji, hashtags, calls to action.",
    "Keep the source's hedges (\"allegedly\", \"according to\").",
    "The test: does a reader who already read the headline and the deck learn something new and specific from this point? If not, it is a repeat.",
  ].join("\n"),
};

export const pointSpec = (tenant) => POINT_SPEC[(tenant?.language || "en") === "it" ? "it" : "en"];

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
    ``,
    pointSpec(tenant),
    ``,
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

/**
 * spawnSync's result shape without blocking the event loop: a round asks the agent for several
 * stories at once. `{ status, stdout, stderr }`, or `{ error }` when the command cannot start or
 * runs past `timeout`.
 */
export function spawnAgent(bin, args, { input = "", timeout, env, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false, timer = null;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ stdout, stderr, status: null, ...r }); };
    let child;
    try { child = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"] }); } catch (error) { return finish({ error }); }
    if (timeout) timer = setTimeout(() => { child.kill("SIGKILL"); finish({ error: Object.assign(new Error(`agent timed out after ${timeout} ms`), { code: "ETIMEDOUT" }) }); }, timeout);
    child.stdout.setEncoding("utf8").on("data", (d) => { stdout += d; if (stdout.length > maxBuffer) child.kill("SIGKILL"); });
    child.stderr.setEncoding("utf8").on("data", (d) => { stderr += d; });
    child.on("error", (error) => finish({ error }));
    child.on("close", (status) => finish({ status }));
    child.stdin.on("error", () => { /* the agent exited before reading its prompt: its status says why */ });
    child.stdin.end(input);
  });
}

/**
 * Run the agent command with the prompt on stdin; resolve its stdout. `spawnImpl` takes
 * spawnSync's arguments and returns its result shape (or a promise of it).
 */
export async function askSummaryAgent(agent, prompt, { spawnImpl = spawnAgent } = {}) {
  const [bin, ...args] = agent.command;
  const r = await spawnImpl(bin, args, { input: prompt, encoding: "utf8", timeout: agent.timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ZIGGY_SUMMARY: "1" } });
  if (r.error) throw new Error(r.error.code === "ENOENT" ? `summary agent command not found: ${bin}` : r.error.message);
  if (r.status !== 0) throw new Error(`summary agent exited ${r.status}: ${(r.stderr || "").trim().slice(0, 400)}`);
  return String(r.stdout || "");
}

/* ── Points: one filtered list for the reel and the caption ────────────────
 * The reel slides and the caption bullets are the same points: a point that
 * retells the headline, the dek or an earlier point is a repetition on a slide
 * as much as in the caption, so it is dropped from both. Two checks: lint.mjs
 * pointsReport (shared words) and judge.mjs (meaning, by the summary agent), and
 * refinePoints has the failing ones replaced from the article, up to 3 rounds. */

/** At most this many points survive on the reel; the caption shows the first CAPTION_POINTS. */
export const REEL_POINTS = 4;
export const CAPTION_POINTS = 3;
/** Rounds of judge → replace → judge again before a failing point is dropped. */
export const REFINE_ROUNDS = 3;

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
  en: {
    "no new words": "says nothing the headline and deck do not", title: "repeats the headline", dek: "repeats the deck", point: "repeats another point", lint: "repeats the caption", max: "one too many",
    generic: "generic: a comment or a line about the sources, no fact", ungrounded: "not in the article", "no new fact": "adds no new fact",
    vs: { title: "the headline", dek: "the deck", point: "point" },
  },
  it: {
    "no new words": "non dice nulla che titolo e sommario non dicano", title: "ripete il titolo", dek: "ripete il sommario", point: "ripete un altro punto", lint: "ripete la didascalia", max: "uno di troppo",
    generic: "generico: un commento o una frase sulle fonti, nessun fatto", ungrounded: "non è nell'articolo", "no new fact": "non aggiunge un fatto nuovo",
    vs: { title: "il titolo", dek: "il sommario", point: "il punto" },
  },
};

/** Why a point failed, for the agent: "repeats the deck (0.85)", "not in the article", … */
export function rejectedWhy(reason, lang = "en") {
  const why = REJECTED_WHY[lang === "it" ? "it" : "en"];
  const m = /^semantic ([\d.]+) vs (title|dek|point (\d+))$/.exec(String(reason));
  if (!m) return why[reason] || reason;
  const what = m[3] ? `${why.vs.point} ${m[3]}` : why.vs[m[2]];
  return `${lang === "it" ? "ripete" : "repeats"} ${what} (${m[1]})`;
}

/**
 * The replacement ask: the points in order, the good ones (✓) to keep word for word, the failing
 * ones (✗) with why, to be replaced by a different fact from the article. `verdicts` are
 * `{ point, pass, reason }`. Pure.
 */
export function buildReplacePrompt(tenant, story, verdicts = []) {
  const lang = (tenant.language || "en") === "it" ? "it" : "en";
  const it = lang === "it";
  const list = verdicts.map((v, i) => `${i + 1}. ${v.pass ? "✓" : "✗"} ${v.point}${v.pass ? "" : ` — ${rejectedWhy(v.reason, lang)}`}`);
  return [
    it
      ? `Questi sono i punti di una notizia per le slide di un reel verticale e la sua didascalia, in ordine. Quelli con ✗ sono stati scartati, quelli con ✓ vanno bene:`
      : `These are the points of a news story for the slides of a vertical reel and its caption, in order. The ones marked ✗ were rejected, the ones marked ✓ are good:`,
    ...list,
    ``,
    it
      ? `Sostituisci SOLO i punti ✗: per ognuno scegli un altro fatto dell'articolo che titolo, sommario (Headline, Deck) e gli altri punti non dicono, oppure riscrivilo in modo che aggiunga un fatto nuovo. Lascia i punti ✓ identici, parola per parola, al loro posto. Se l'articolo non ha un altro fatto, togli il punto invece di inventarlo.`
      : `Replace ONLY the ✗ points: for each, pick a different fact from the article that the headline, the deck and the other points do not hold, or rewrite it so it adds a new fact. Keep the ✓ points word for word, in their place. If the article holds no other fact, leave the point out rather than invent one.`,
    it
      ? `Regole: frasi brevi (max 90 caratteri l'una), italiano semplice, niente emoji, niente numerazione, una frase per punto.`
      : `Rules: short sentences (max 90 characters each), plain language, no emoji, no numbering, one sentence per point.`,
    ``,
    POINT_SPEC[lang],
    ``,
    it
      ? `Stampa SOLO la lista completa dei punti, in ordine, uno per riga, senza ✓ e ✗, nient'altro.`
      : `Print ONLY the full list of points, in order, one per line, without the ✓ and ✗ marks, nothing else.`,
    ``,
    `Headline: ${story.title}`,
    `Deck: ${story.dek}`,
    `Article: ${String(story.body ?? "").trim()}`,
  ].join("\n");
}

/** Each point of `list` (already clean) with its lexical reason, null when pointsReport keeps it. */
export function lexicalReasons(tenant, story, list) {
  const { kept, dropped } = storyPoints(tenant, story, list);
  let k = 0, d = 0;
  return list.map((point) => (kept[k] === point ? (k++, null) : dropped[d++]?.reason ?? "lint"));
}

const sameText = (a, b) => String(a).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === String(b).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The agent's reply to buildReplacePrompt into the next list: the passing points stay, in place;
 * each failing one takes the next replacement, or leaves (`removed`) when the agent wrote none or
 * gave it back unchanged. A reply as long as the list is read by position; otherwise every line
 * that is not a passing point is a replacement.
 */
function mergeReplacements(verdicts, lines) {
  const passing = (l) => verdicts.some((v) => v.pass && sameText(v.point, l));
  const fresh = lines.length === verdicts.length ? lines.filter((_, i) => !verdicts[i].pass) : lines.filter((l) => !passing(l));
  const next = [], removed = [], replaced = [];
  let k = 0;
  for (const v of verdicts) {
    if (v.pass) { next.push(v.point); continue; }
    const line = fresh[k++];
    if (line && !sameText(line, v.point) && !passing(line) && !next.some((p) => sameText(p, line))) { next.push(line); replaced.push({ point: v.point, reason: v.reason, by: line }); }
    else removed.push({ point: v.point, reason: v.reason });
  }
  return { next, removed, replaced };
}

/**
 * The points a story keeps, on its reel and in its caption. Each round checks every point with
 * the lexical filter (storyPoints) and the semantic judge (judge.mjs, the summary agent): a point
 * fails when either rejects it. When one fails, the agent replaces only the failing points from
 * the article (buildReplacePrompt), and the new list is checked again — at most `maxRounds`
 * checks; what still fails after the last is dropped. 0–4 points is fine: never a refusal.
 *
 *   no agent        lexical only, no rewrite (the old behaviour)
 *   judge off/fails lexical decides (tenant.feed.judge === false, ZIGGY_JUDGE=0, a bad reply)
 *   no article      no rewrite (new facts can only come from it); still judged and dropped
 *
 * `story.body` is fetched when the story does not carry it. Returns `{ points, kept, dropped,
 * replaced, rewritten, rounds, judgeCalls, rewriteCalls, judge, threshold, ms }`: `points` and
 * `kept` are the final list, `dropped` the points left out (`{ point, reason }`, reason lexical
 * or "semantic 0.83 vs dek" / "generic" / "ungrounded" / "no new fact"), `replaced` the ones a
 * rewrite swapped out, `judge` "on" | "off" | "failed".
 */
export async function refinePoints(tenant, story, points, { agent = storyAgent(tenant), spawnImpl, fetchImpl, maxRounds = REFINE_ROUNDS, threshold } = {}) {
  const started = Date.now();
  const cfg = judgeConfig(tenant);
  const out = { rounds: 0, judgeCalls: 0, rewriteCalls: 0, judge: agent && cfg.enabled ? "on" : "off", threshold: threshold ?? cfg.threshold };
  let list = (Array.isArray(points) ? points : []).map(cleanPoint).filter(Boolean);
  const body = agent ? story.body ?? await fetchStoryBody(tenant, story, { fetchImpl }) : story.body;
  const full = { ...story, body: body ?? "" };
  const removed = [], replaced = [], rewrites = new Set();

  const check = async () => {
    const lexical = lexicalReasons(tenant, full, list);
    let judged = null;
    if (out.judge === "on" && lexical.some((r) => !r)) {
      out.judgeCalls++;
      judged = await judgePoints(tenant, full, list, { agent, spawnImpl, threshold: out.threshold });
      if (!judged) out.judge = "failed";
    }
    return list.map((point, i) => {
      const j = judged?.[i];
      const reason = lexical[i] || (j && !j.pass ? judgeReason(j, out.threshold) : null);
      return { point, pass: !reason, reason, ...(j ? { score: j.score, against: j.against, newFact: j.newFact } : {}) };
    });
  };

  let verdicts = [];
  while (list.length) {
    out.rounds++;
    verdicts = await check();
    if (verdicts.every((v) => v.pass) || out.rounds >= maxRounds || !agent || !String(body || "").trim()) break;
    let lines;
    try {
      out.rewriteCalls++;
      lines = parseSummaryLines(await askSummaryAgent(agent, buildReplacePrompt(tenant, full, verdicts), { spawnImpl }));
    } catch { break; }
    const merged = mergeReplacements(verdicts, lines);
    removed.push(...merged.removed);
    replaced.push(...merged.replaced);
    for (const r of merged.replaced) rewrites.add(r.by);
    list = merged.next;
    // nothing new to check: the passing points pass in a shorter list too
    if (!merged.replaced.length) { verdicts = verdicts.filter((v) => v.pass); break; }
  }
  const kept = verdicts.filter((v) => v.pass).map((v) => v.point);
  const dropped = [...removed, ...verdicts.filter((v) => !v.pass).map(({ point, reason }) => ({ point, reason }))];
  return { points: kept, kept, dropped, replaced, rewritten: kept.some((p) => rewrites.has(p)), ...out, ms: Date.now() - started };
}

/**
 * The summary and its points: the tenant's agent writes the slides, from the article body too
 * (fetched when the story does not carry one), and refinePoints keeps the ones that add a fact.
 * Null without an agent; a failing first ask throws.
 */
async function summarize(tenant, story, { spawnImpl, fetchImpl } = {}) {
  const agent = storyAgent(tenant);
  if (!agent) return null;
  const body = story.body ?? await fetchStoryBody(tenant, story, { fetchImpl });
  const lines = parseSummaryLines(await askSummaryAgent(agent, buildSummaryPrompt(tenant, { ...story, body }), { spawnImpl }));
  return refinePoints(tenant, { ...story, body }, lines, { agent, spawnImpl, fetchImpl });
}

/**
 * The pre-script: the summary slides that survive refinePoints. Null without an agent; a failing
 * first ask throws, and createStoryCampaign goes on without points — a story campaign must
 * always come out.
 */
export async function summarizeStory(tenant, story, options = {}) {
  return (await summarize(tenant, story, options))?.points ?? null;
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
 * they go through storyPoints, and only the kept ones are used. `dropped` (refinePoints') goes
 * in front of copy.droppedPoints. Pure.
 */
export function campaignFromStory(tenant, story, { name, points: given, dropped: refused = [] } = {}) {
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
    copy: { kicker, headline: story.title, dek: story.dek, points, captionPoints: shown, droppedPoints: [...refused, ...dropped], meta, sources: story.sources ?? null, url: displayUrl },
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
export async function createStoryCampaign(tenant, { index = 0, story: given = null, name, fetchImpl, force = false, spawnImpl, summarize: withSummary = true, write = true } = {}) {
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
  let refined = null;
  if (withSummary) {
    try { refined = await summarize(tenant, story, { spawnImpl, fetchImpl }); }
    catch { refined = null; /* a broken agent must not block the campaign */ }
  }
  const campaign = campaignFromStory(tenant, story, { name, points: refined?.points ?? null, dropped: refined?.dropped });
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
