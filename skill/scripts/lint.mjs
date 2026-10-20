/**
 * Caption lint: a caption must not say the same thing twice. The old story caption put the AI
 * summary points under the dek, and the points are paraphrases of the headline and dek, so every
 * caption told the story twice. Pure: no I/O, no side effects on import.
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
    .flatMap((p) => p.split(/\n+|(?<=[.!?…])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
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
