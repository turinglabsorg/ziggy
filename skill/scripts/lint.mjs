/**
 * Caption lint: a caption must not say the same thing twice. The old story caption put every AI
 * summary point under the dek, and the points written from headline and dek alone paraphrased
 * them, so every caption told the story twice. The points are back only when they add facts:
 * pointsReport keeps the ones that say something the headline, the dek and the points before them
 * do not (numbers, names, dates, what happens next, from the story body), and drops the rest from
 * the reel slides and the caption alike — they are the same list (story.mjs storyPoints). Pure:
 * no I/O, no side effects on import.
 *
 * Similarity is word overlap over content words, |A∩B| / min(|A|,|B|), after dropping URLs,
 * hashtags, the "Basato su… / Sourced from…" line, a case file's "Source: …" line and point
 * labels ("✅ CONFIRMED:", "THE CLAIM:"), words under 3 letters and common Italian and English
 * function words. Sentences with fewer than 4 content words are not compared.
 *
 * Two thresholds: 0.6 between caption sentences, 0.8 against the headline. A dek is written to
 * expand its headline and reuses its names and places (0.75 on a good Alien Watch caption, the
 * rest of the real captions under 0.6), while a point retelling the headline scores 0.9–1.
 */

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const SOURCES_RE = /\b(?:Basato su|Sourced from)\b[^.\n]*\.?/gi;
const SOURCE_LINE_RE = /^(?:Sources?|Fonti?)\s*:/i;
// an upper-case label opening a paragraph, behind an optional emoji: "✅ CONFIRMED: ", "THE CLAIM: "
const CAPS_LABEL_RE = /^[^\p{L}\p{N}\s]*\s*\p{Lu}[\p{Lu}\p{N} '’-]{1,30}:\s+/u;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "these", "those", "are", "was", "were", "has", "have", "had",
  "been", "its", "but", "not", "into", "than", "then", "they", "their", "them", "there", "what", "which", "who",
  "will", "would", "can", "could", "may", "might", "also", "more", "most", "over", "after", "before", "about",
  "all", "any", "out", "our", "his", "her", "she", "him", "you", "your", "now", "says", "said",
  "che", "del", "della", "delle", "dei", "degli", "dello", "dell", "dal", "dalla", "dalle", "dai", "dagli", "dallo",
  "dall", "nel", "nella", "nelle", "nei", "negli", "nello", "nell", "sul", "sulla", "sulle", "sui", "sugli", "sullo",
  "sull", "alla", "alle", "agli", "allo", "per", "con", "tra", "fra", "una", "uno", "gli", "non", "sono", "stato",
  "stata", "stati", "state", "essere", "viene", "anche", "come", "piu", "gia", "ancora", "dopo", "prima", "dove",
  "quando", "questo", "questa", "questi", "queste", "quello", "quella", "quell", "quest", "suo", "sua", "suoi",
  "sue", "loro", "hanno", "aveva", "sara", "tutto", "tutti", "ogni", "cui", "chi", "perche",
]);

/** The content words of a text: accents and punctuation off, short and function words dropped. */
export function contentWords(text) {
  return new Set(String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}

export function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/** A paragraph's sentences: one per line, and split after `.`, `!`, `?` and `…`. */
export function splitSentences(text) {
  return String(text || "").split(/\n+|(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * The caption's sentences, without the headline paragraph, links, hashtags, the sources line,
 * a case file's source line and the labels in front of its points (`labels`: the item's own).
 */
export function captionSentences(caption, title = "", { labels = [] } = {}) {
  const paragraphs = String(caption || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (title && paragraphs[0] === String(title).trim()) paragraphs.shift();
  return paragraphs
    .filter((p) => !SOURCE_LINE_RE.test(p))
    .map((p) => stripPointLabels(p, labels).replace(CAPS_LABEL_RE, ""))
    .map((p) => p.replace(URL_RE, " ").replace(HASHTAG_RE, " ").replace(SOURCES_RE, " "))
    .flatMap(splitSentences);
}

/**
 * Pairs of caption sentences that say the same thing: every sentence against every other
 * (`threshold`), and each one against the headline (`titleThreshold`). `ok` is false when any
 * pair reaches its threshold.
 */
export function captionRepetition(caption, { title = "", threshold = 0.6, titleThreshold = 0.8, labels = [] } = {}) {
  const sentences = captionSentences(caption, title, { labels })
    .map((text) => ({ text, words: contentWords(text) }))
    .filter((s) => s.words.size >= 4);
  const pairs = [];
  const head = contentWords(title);
  if (head.size >= 4) {
    for (const s of sentences) {
      const score = overlap(head, s.words);
      if (score >= titleThreshold) pairs.push({ a: String(title).trim(), b: s.text, score });
    }
  }
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      const score = overlap(sentences[i].words, sentences[j].words);
      if (score >= threshold) pairs.push({ a: sentences[i].text, b: sentences[j].text, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return { ok: pairs.length === 0, pairs };
}

const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The refusal a round, the daily loop and publish print: the worst pair, clipped. */
export function repetitionReason(pairs) {
  const [p] = pairs;
  return p ? `caption repeats itself: "${clip(p.a)}" ~ "${clip(p.b)}"` : "";
}

/**
 * Every caption a campaign would post (its enabled kinds, `only` when given; an X post with its
 * replies), each linted once with captionRepetition: the headline is copy.headline, a case
 * file's labels and source line are not sentences of the story. The weekly events reel is not
 * linted: its caption is a list, and its lines share towns, venues and weekdays by design.
 * `{ ok, kind, pairs, reason }` for the first caption that fails.
 */
export function campaignRepetition(campaign, { only } = {}) {
  if (Array.isArray(campaign?.events)) return { ok: true, skipped: "list caption", pairs: [] };
  const title = campaign?.copy?.headline || campaign?.copy?.title || campaign?.story?.title || "";
  const labels = campaign?.casefile?.labels || [];
  const seen = new Set();
  for (const [kind, spec] of Object.entries(campaign?.posts || {})) {
    if (!spec || spec.enabled === false || (only?.length && !only.includes(kind))) continue;
    const text = [spec.body, ...(Array.isArray(spec.thread) ? spec.thread.map((t) => t?.body) : [])].filter(Boolean).join("\n\n");
    if (seen.has(text)) continue;
    seen.add(text);
    const r = captionRepetition(text, { title, labels });
    if (!r.ok) return { ok: false, kind, pairs: r.pairs, reason: repetitionReason(r.pairs) };
  }
  return { ok: true, pairs: [] };
}

// a list marker in front of a point: "• ", "* ", "- ", "1. ", "2) " (never the "3." of "3.000")
const POINT_MARKER_RE = /^(?:\s*(?:[•·*]|[-–—](?=\s)|\d{1,2}[.)](?=\s)))+\s*/u;
// the numbers as written ("7", "7:30", "1.200", "30/11"): contentWords drops the short ones
const numbers = (text) => new Set(String(text || "").match(/\d+(?:[.,:/]\d+)*/g) || []);

/** A story caption with its points: headline, dek, the points one per "•" line, then `tail`. */
export function storyCaption({ title = "", dek = "", points = [], tail = "" } = {}) {
  const bullets = points.map((p) => `• ${p}`).join("\n");
  return [title, dek, bullets, tail].filter(Boolean).join("\n\n");
}

/**
 * Which summary points a story keeps, on its reel and in its caption: `kept` (trimmed, list
 * markers off, in order, at most `max`) and `dropped`, each with its reason. A point is dropped
 * when it repeats something:
 *
 *   "no new words"  it has 2+ content words, every one already in the headline, the dek or a
 *                   point kept before it, and no number they do not have ("alle 7" is a fact)
 *   "title"         overlap ≥ titleThreshold with the headline
 *   "dek"           overlap ≥ threshold with the whole dek or one of its sentences
 *   "point"         overlap ≥ threshold with a point kept before it, or the same words and numbers
 *   "lint"          one of its sentences makes a pair captionRepetition flags in the caption
 *                   (headline, dek, kept points, `tail`) that the caption without it lacks
 *   "max"           `max` points are already kept
 *
 * Overlap is compared as captionRepetition does, only between sets of 4+ content words. The
 * "lint" check runs the caption lint itself, so the points never make a caption fail it: with
 * `tail` (sources line, CTA, hashtags) the caption is exactly the one that goes out.
 */
export function pointsReport(points, { title = "", dek = "", tail = "", max = 3, threshold = 0.6, titleThreshold = 0.8 } = {}) {
  const big = (words) => words.size >= 4;
  const head = contentWords(title);
  const deks = [contentWords(dek), ...splitSentences(dek).map(contentWords)].filter(big);
  const known = new Set([...head, ...contentWords(dek)]);
  const knownNumbers = new Set([...numbers(title), ...numbers(dek)]);
  const pairs = (pts) => captionRepetition(storyCaption({ title, dek, points: pts, tail }), { title, threshold, titleThreshold }).pairs.length;
  const kept = [], keptWords = [], keptKeys = new Set(), dropped = [];
  let base = pairs([]);
  for (const raw of Array.isArray(points) ? points : []) {
    const point = String(raw ?? "").replace(POINT_MARKER_RE, "").trim();
    if (!point) continue;
    const words = contentWords(point);
    const key = [[...words].sort(), [...numbers(point)].sort()].join("|");
    const told = words.size >= 2 && [...words].every((w) => known.has(w)) && [...numbers(point)].every((n) => knownNumbers.has(n));
    let reason = !words.size || told ? "no new words"
      : big(words) && big(head) && overlap(words, head) >= titleThreshold ? "title"
      : big(words) && deks.some((d) => overlap(words, d) >= threshold) ? "dek"
      : keptKeys.has(key) || (big(words) && keptWords.some((k) => big(k) && overlap(words, k) >= threshold)) ? "point"
      : kept.length >= max ? "max"
      : null;
    if (!reason) {
      const n = pairs([...kept, point]);
      if (n > base) reason = "lint";
      else base = n;
    }
    if (reason) { dropped.push({ point, reason }); continue; }
    kept.push(point);
    keptWords.push(words);
    keptKeys.add(key);
    for (const w of words) known.add(w);
    for (const n of numbers(point)) knownNumbers.add(n);
  }
  return { kept, dropped };
}

/** The points a story keeps: pointsReport's `kept`. */
export function captionPoints(points, options = {}) {
  return pointsReport(points, options).kept;
}

const POINT_LABELS = ["Confirmed", "Not confirmed", "Why it matters", "The claim", "The check", "The answer", "Confermato", "Non confermato", "Perché conta", "Perché è importante"];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A case file point without its label: the caption adds the label back, so a point written as
 * "Confirmed: …" (or "✅ Confirmed: Confirmed: …") would carry it twice. Strips every stacked
 * label, the default ones and the item's own `labels`.
 */
export function stripPointLabels(point, labels = []) {
  const names = [...new Set([...POINT_LABELS, ...(Array.isArray(labels) ? labels : [])].map((l) => String(l ?? "").trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length).map(escapeRe);
  return String(point ?? "").trim().replace(new RegExp(`^(?:[✅❓•*-]?\\s*(?:${names.join("|")})\\s*:\\s*)+`, "iu"), "").trim();
}
