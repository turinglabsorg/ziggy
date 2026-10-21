/**
 * The semantic judge: does a point add a fact, by meaning? lint.mjs pointsReport counts shared
 * words, so a paraphrase gets through ("ha dedicato una scheda specifica al dissesto" for "dedica
 * a Modica una scheda sul dissesto": 0.57 overlap). The judge asks the story's summary agent
 * (story.mjs storyAgent: the same command, no other key) how much of each point the headline,
 * the deck and the points before it already say, which new fact it adds, and whether it makes
 * sense on its own slide (`vague`: "Nomina del presidente ferma…" — president of what?). Pure
 * helpers and one call (judgePoints); any failure is null, and the caller keeps the lexical
 * filter alone.
 *
 *   tenant.json → feed.judge: false            off for the tenant (read only, never written)
 *   tenant.json → feed.judge.threshold: 0.8    a point at or above it repeats
 *   ZIGGY_JUDGE=0, ZIGGY_JUDGE_THRESHOLD=0.8   the same from the environment (tenant.json wins)
 */
import { askSummaryAgent, clipAtSentence, POINT_SPEC, storyAgent } from "./story.mjs";

/**
 * A point this similar (0–1) to the headline, the deck or an earlier point is a repeat. The eval's
 * recommendation (skill/eval/results/2026-10-21-v2.md): new facts scored ≤ 0.7; the repeats under
 * 0.8 named no new fact, and the one repeat that named one scored 0.80.
 */
export const DEFAULT_JUDGE_THRESHOLD = 0.8;
/** The article in the prompt, clipped like the summary's. */
const ARTICLE_CHARS = 2500;

const ratio = (v) => {
  if (v === undefined || v === null || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : null;
};

/** `{ enabled, threshold }` from tenant.json → feed.judge, then the environment, then the default. */
export function judgeConfig(tenant, env = process.env) {
  const j = tenant?.feed?.judge;
  const off = j === false || /^(0|false|off|no)$/i.test(String(env.ZIGGY_JUDGE ?? "").trim());
  return { enabled: !off, threshold: ratio(j?.threshold) ?? ratio(env.ZIGGY_JUDGE_THRESHOLD) ?? DEFAULT_JUDGE_THRESHOLD };
}

const TEXT = {
  it: {
    task: [
      "Controlli i punti di una notizia prima che vadano sulle slide di un reel e nella didascalia, sotto titolo e sommario. Per ogni punto, nell'ordine, valuta quanta della sua informazione è già data:",
      "- vsTitle: dal titolo (Headline);",
      "- vsDek: dal sommario (Deck);",
      "- vsPoints: da ciascun punto prima di lui, un valore per punto, nell'ordine ([] per il primo).",
      "Conta il significato, non le parole: 1 = la stessa informazione con altre parole (sinonimi, ordine diverso, lo stesso fatto detto in modo più o meno preciso), 0 = un'informazione del tutto nuova. Un punto che riprende un fatto già noto ma aggiunge un numero, un nome, una data o un dettaglio nuovo vale poco: conta la parte nuova.",
      "- newFact: il fatto nuovo e preciso che il punto aggiunge, in massimo 12 parole; \"\" se non ne aggiunge.",
      "- grounded: true se quello che il punto dice è nell'articolo (o in titolo e sommario); false se aggiunge qualcosa che l'articolo non dice.",
      "- generic: true se è un commento o un giudizio generico, una frase sulle fonti (\"le fonti non…\"), una domanda o un invito all'azione.",
      "- vague: true se chi legge solo questa slide del reel non capisce di chi o di cosa parla il punto (\"il presidente\" senza dire di cosa, \"la nomina\", \"l'atto\", \"lo stesso partito\" senza il loro riferimento), o se accenna a dei fatti senza dirli (un elenco di parole generiche come \"incompatibilità, dimissioni e un parere\"). Il soggetto principale della notizia, quello del titolo, può restare sottinteso.",
    ],
    examples: [
      "Esempi. Titolo: \"Ragusa, chiuso il ponte di via Roma per lavori\". Sommario: \"Il Comune ha chiuso il ponte al traffico per consolidare i piloni; i bus passano da via Ercolano.\"",
      "- \"Il ponte di via Roma non è più percorribile dalle auto per i lavori.\" → {\"vsTitle\":0.9,\"vsDek\":0.9,\"newFact\":\"\",\"grounded\":true,\"generic\":false,\"vague\":false} (la stessa informazione con altre parole)",
      "- \"Il ponte resterà chiuso per lavori almeno 90 giorni.\" → {\"vsTitle\":0.3,\"vsDek\":0.3,\"newFact\":\"chiusura di almeno 90 giorni\",\"grounded\":true,\"generic\":false,\"vague\":false} (riprende la chiusura, aggiunge la durata)",
      "- \"Le fonti non indicano quando il ponte riaprirà.\" → {\"vsTitle\":0.2,\"vsDek\":0.2,\"newFact\":\"\",\"grounded\":true,\"generic\":true,\"vague\":false} (una frase sulle fonti, nessun fatto)",
      "- \"L'appalto da 1,2 milioni è andato alla ditta Edilsud di Modica.\" → {\"vsTitle\":0.1,\"vsDek\":0.1,\"newFact\":\"appalto da 1,2 milioni alla ditta Edilsud\",\"grounded\":true,\"generic\":false,\"vague\":false} (un nome e una cifra nuovi)",
      "- \"Il dirigente ha firmato l'atto dopo un parere atteso da settimane.\" → {\"vsTitle\":0.3,\"vsDek\":0.3,\"newFact\":\"atto firmato dopo un parere\",\"grounded\":true,\"generic\":false,\"vague\":true} (quale dirigente, quale atto, quale parere? sulla slide non si capisce)",
    ],
    reply: "Rispondi SOLO con questo JSON, nient'altro, un oggetto per punto, con i da 0 a N-1:",
    noArticle: "(nessun articolo: grounded è true, salvo che il punto contraddica titolo o sommario)",
  },
  en: {
    task: [
      "You check the points of a news story before they go on the slides of a reel and in the caption, under the headline and the deck. For each point, in order, rate how much of its information is already given:",
      "- vsTitle: by the headline;",
      "- vsDek: by the deck;",
      "- vsPoints: by each point before it, one value per earlier point, in order ([] for the first).",
      "Judge meaning, not words: 1 = the same information in other words (synonyms, reordered, the same fact worded more or less specifically), 0 = entirely new information. A point that picks up a known fact but adds a new number, name, date or detail scores low: the new part is what counts.",
      "- newFact: the specific new fact the point adds, in 12 words at most; \"\" if it adds none.",
      "- grounded: true if what the point says is in the article (or in the headline and the deck); false if it adds something the article does not say.",
      "- generic: true for generic commentary or evaluation, a statement about the sources (\"the sources do not…\"), a question or a call to action.",
      "- vague: true if a reader of this reel slide alone could not tell who or what the point is about (\"the chair\" without saying of what, \"the appointment\", \"the measure\", \"the same party\" without their referent), or if it gestures at facts without stating them (a list of generic nouns such as \"incompatibilities, resignations and an opinion\"). The story's main subject, the headline's, may stay implied.",
    ],
    examples: [
      "Examples. Headline: \"Council closes Harbour Bridge for repairs\". Deck: \"The city shut the bridge to traffic to reinforce its piers; buses run via King Street.\"",
      "- \"Harbour Bridge is no longer open to cars while the repairs go on.\" → {\"vsTitle\":0.9,\"vsDek\":0.9,\"newFact\":\"\",\"grounded\":true,\"generic\":false,\"vague\":false} (the same information in other words)",
      "- \"The bridge will stay closed for repairs for at least 90 days.\" → {\"vsTitle\":0.3,\"vsDek\":0.3,\"newFact\":\"closure of at least 90 days\",\"grounded\":true,\"generic\":false,\"vague\":false} (picks up the closure, adds how long)",
      "- \"The sources do not say when the bridge will reopen.\" → {\"vsTitle\":0.2,\"vsDek\":0.2,\"newFact\":\"\",\"grounded\":true,\"generic\":true,\"vague\":false} (a line about the sources, no fact)",
      "- \"The €1.2 million contract went to Northline Builders, the council said.\" → {\"vsTitle\":0.1,\"vsDek\":0.1,\"newFact\":\"€1.2 million contract to Northline Builders\",\"grounded\":true,\"generic\":false,\"vague\":false} (a new name and amount)",
      "- \"The official signed the order after an opinion awaited for weeks.\" → {\"vsTitle\":0.3,\"vsDek\":0.3,\"newFact\":\"order signed after an opinion\",\"grounded\":true,\"generic\":false,\"vague\":true} (which official, which order, which opinion? the slide does not say)",
    ],
    reply: "Reply with ONLY this JSON, nothing else, one object per point, i from 0 to N-1:",
    noArticle: "(no article: grounded is true unless the point contradicts the headline or the deck)",
  },
};

const SHAPE = `{"points":[{"i":0,"vsTitle":0.0,"vsDek":0.0,"vsPoints":[],"newFact":"","grounded":true,"generic":false,"vague":false}]}`;

/**
 * The judge's prompt: the task, the CAN/CANNOT spec, five calibration examples, the JSON shape,
 * then headline, deck, article (clipped) and the points numbered from 0. Pure.
 */
export function buildJudgePrompt(tenant, { title = "", dek = "", body = "", points = [] } = {}) {
  const lang = (tenant?.language || "en") === "it" ? "it" : "en";
  const t = TEXT[lang];
  const article = String(body ?? "").trim();
  return [
    ...t.task,
    ``,
    POINT_SPEC[lang],
    ``,
    ...t.examples,
    ``,
    t.reply,
    SHAPE,
    ``,
    `Headline: ${title}`,
    `Deck: ${dek}`,
    `Article: ${article ? clipAtSentence(article, ARTICLE_CHARS) : t.noArticle}`,
    `Points:`,
    ...points.map((p, i) => `${i}. ${String(p ?? "").trim()}`),
  ].join("\n");
}

/** The end of the JSON value that opens at `start` (a `{`), or -1. Strings and escapes respected. */
function closingBrace(s, start) {
  let depth = 0, inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === "\"") inString = false;
    } else if (c === "\"") inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** The first object with a `points` array in `text`: the whole text, `{"result": …}`, a fenced or embedded block. */
function findPoints(text, depth = 0) {
  const s = String(text ?? "").trim();
  if (!s || depth > 2) return null;
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j?.points)) return j;
    if (typeof j?.result === "string") return findPoints(j.result, depth + 1);
    if (Array.isArray(j?.result?.points)) return j.result;
  } catch { /* not JSON as a whole */ }
  for (let start = s.indexOf("{"); start !== -1; start = s.indexOf("{", start + 1)) {
    const end = closingBrace(s, start);
    if (end < 0) continue;
    try {
      const j = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(j?.points)) return j;
    } catch { /* a brace inside prose */ }
  }
  return null;
}

const unit = (v) => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};
const flag = (v, fallback) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : v == null ? fallback : null);

/**
 * The judge's reply for `n` points → `[{ i, vsTitle, vsDek, vsPoints, newFact, grounded, generic, vague }]`
 * in point order, or null: no JSON with `points`, a point missing or twice, a score outside 0–1,
 * fewer `vsPoints` than earlier points. `grounded` defaults to true, `generic` and `vague` to false.
 */
export function parseJudge(text, n) {
  const found = findPoints(text);
  if (!found || !Number.isInteger(n) || n < 0) return null;
  const out = new Array(n).fill(null);
  for (const [pos, p] of found.points.entries()) {
    if (!p || typeof p !== "object") return null;
    const i = p.i === undefined ? pos : Number(p.i);
    if (!Number.isInteger(i) || i < 0 || i >= n || out[i]) return null;
    const vsTitle = unit(p.vsTitle), vsDek = unit(p.vsDek);
    const rawPoints = p.vsPoints == null && i === 0 ? [] : p.vsPoints;
    if (vsTitle === null || vsDek === null || !Array.isArray(rawPoints) || rawPoints.length < i) return null;
    const vsPoints = rawPoints.slice(0, i).map(unit);
    if (vsPoints.some((v) => v === null)) return null;
    const grounded = flag(p.grounded, true), generic = flag(p.generic, false), vague = flag(p.vague, false);
    if (grounded === null || generic === null || vague === null) return null;
    const newFact = typeof p.newFact === "string" ? p.newFact.trim() : p.newFact == null ? "" : null;
    if (newFact === null) return null;
    out[i] = { i, vsTitle, vsDek, vsPoints, newFact, grounded, generic, vague };
  }
  return out.every(Boolean) ? out : null;
}

/** The highest similarity and what it is against: "title", "dek" or "point N" (1-based); ties go to the first. */
export function strongest({ vsTitle, vsDek, vsPoints = [] }) {
  let score = vsTitle, against = "title";
  if (vsDek > score) { score = vsDek; against = "dek"; }
  vsPoints.forEach((v, k) => { if (v > score) { score = v; against = `point ${k + 1}`; } });
  return { score, against };
}

/** Why the judge fails a point: "ungrounded", "semantic 0.83 vs dek", "generic", "vague", "no new fact". */
export function judgeReason(verdict, threshold = judgeConfig(null).threshold) {
  if (verdict.grounded === false) return "ungrounded";
  if (verdict.score >= threshold) return `semantic ${verdict.score.toFixed(2)} vs ${verdict.against}`;
  if (verdict.generic) return "generic";
  if (verdict.vague) return "vague";
  return "no new fact";
}

/**
 * Judge a story's points, in order, in one call to the summary agent. Per point `{ point, score,
 * against, newFact, grounded, generic, vague, pass, vsTitle, vsDek, vsPoints }`, where `score` is
 * the highest similarity and `pass` = score < threshold, a new fact named, grounded, not generic
 * and not vague.
 * [] for no points; null when the judge is off, there is no agent, or the agent fails or answers
 * something unreadable — never a throw.
 */
export async function judgePoints(tenant, story, points, { agent = storyAgent(tenant), spawnImpl, threshold } = {}) {
  const cfg = judgeConfig(tenant);
  if (!cfg.enabled || !agent) return null;
  const list = (Array.isArray(points) ? points : []).map((p) => String(p ?? "").trim());
  if (!list.length) return [];
  const limit = threshold ?? cfg.threshold;
  let parsed;
  try {
    const prompt = buildJudgePrompt(tenant, { title: story?.title, dek: story?.dek, body: story?.body, points: list });
    parsed = parseJudge(await askSummaryAgent(agent, prompt, { spawnImpl }), list.length);
  } catch { return null; }
  if (!parsed) return null;
  return parsed.map((p, i) => {
    const { score, against } = strongest(p);
    const pass = score < limit && p.newFact !== "" && p.grounded !== false && !p.generic && p.vague !== true;
    return { point: list[i], score, against, newFact: p.newFact, grounded: p.grounded, generic: p.generic, vague: p.vague, pass, vsTitle: p.vsTitle, vsDek: p.vsDek, vsPoints: p.vsPoints };
  });
}
