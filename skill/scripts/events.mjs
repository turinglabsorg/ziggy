/**
 * The week's events as a reel. A tenant with an events calendar declares it in
 * `tenant.json → events` (apiUrl, url, exclusions, limits, Italian category labels, template),
 * and `ziggy events <slug> --week` turns the coming week into a campaign on the
 * `eventi-settimana` template: an intro with the date range, one card per event, an outro that
 * sends people to the calendar. `--teaser` writes the evergreen `eventi-teaser` campaign instead.
 *
 * Everything here is pure except `fetchWeekEvents`, `downloadPosters` and `runReportHook`, so
 * the selection can be pinned by tests: same events + same config + same week → same reel.
 *
 * Dates: the API gives local wall times ("2026-10-30T20:30", Europe/Rome). Days are compared as
 * YYYY-MM-DD strings and moved with UTC calendar math, so a DST change inside the week never
 * shifts a day.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EVENTS_DEFAULTS = {
  apiUrl: "https://ragusa.buzz/v1/events",
  url: "https://ragusa.buzz/eventi",
  tz: "Europe/Rome",
  lookbackDays: 45,
  excludeCategories: ["religione", "istituzionale", "corsi", "formazione", "convegni", "conferenze"],
  excludeTitles: ["cresim", "consiglio comunale", "seduta"],
  // conference-type events stay out of the reel whatever their category says; every other event is in
  excludeConferences: ["convegn", "conferenz", "seminari", "tavola rotonda", "tavole rotonde", "workshop", "webinar", "simposio", "congress", "\\bmeeting\\b", "giornata di studi", "corso biennale", "conversazion", "dibattit"],
  // every event of the week gets its own card; the cap only guards the reel's length
  maxEvents: 40,
  minEvents: 3,
  template: "eventi-settimana",
  teaserTemplate: "eventi-teaser",
  // sources whose all-day end at 00:00 is the day after the last one (iCal DTEND); every other
  // source writes the last day itself at 00:00
  exclusiveEndSources: [],
  hashtags: "#Ragusa #Sicilia #EventiRagusa",
  categoryLabels: {
    "musica-live": "Musica live", teatro: "Teatro", mostre: "Mostra", sagre: "Sagra", feste: "Festa",
    cinema: "Cinema", libri: "Libri", danza: "Danza", natura: "Natura", sport: "Sport", bambini: "Per bambini",
    altro: "Evento", "": "Evento",
  },
  categoryWeights: { "musica-live": 3, teatro: 3, sagre: 3, feste: 3, mostre: 2, cinema: 2, libri: 2, danza: 2, bambini: 1, natura: 1, sport: 1 },
  weights: { poster: 3, evening: 2, weekend: 2, startsInWeek: 1, longSpan: -2, longSpanDays: 14, sameTown: 0 },
  teaser: {
    categories: ["concerti", "mostre", "teatro", "sagre"],
    towns: ["Ragusa", "Modica", "Scicli", "Vittoria", "Comiso", "Pozzallo", "Ispica", "Santa Croce", "Chiaramonte", "Giarratana", "Acate", "Monterosso"],
  },
};

/** The tenant's `events` block over the defaults; a tenant without one has no events command. */
export function eventsConfig(tenant) {
  const e = tenant.events;
  if (!e || typeof e !== "object") throw new Error(`tenant ${tenant.slug} has no events block in tenant.json (see references/events.md)`);
  const d = EVENTS_DEFAULTS;
  return {
    ...d, ...e,
    categoryLabels: { ...d.categoryLabels, ...(e.categoryLabels || {}) },
    categoryWeights: { ...d.categoryWeights, ...(e.categoryWeights || {}) },
    weights: { ...d.weights, ...(e.weights || {}) },
    teaser: { ...d.teaser, ...(e.teaser || {}) },
  };
}

/* ── calendar days ──────────────────────────────────────────────────────── */

const WEEKDAYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
const WEEKDAYS_LONG = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];
const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MONTHS_LONG = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (day) => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export function addDays(day, n) {
  return fromUtc(toUtc(day) + n * 86400000);
}

export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(day) {
  return (new Date(toUtc(day)).getUTCDay() + 6) % 7;
}

/** The calendar day of `now` in `tz` (YYYY-MM-DD). */
export function localDay(now, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The week to show, Monday to Sunday. `from` wins and is snapped to its Monday. Otherwise the
 * day of `now` in the tenant's time zone decides: Friday to Sunday look at the coming week,
 * Monday to Thursday at the current one. `from` + `to` is an exact range, not snapped (the rest
 * of a week: «21–25 ott»), at most 14 days.
 */
export function resolveWeek({ now = new Date(), tz = EVENTS_DEFAULTS.tz, from, to } = {}) {
  if (to) {
    if (!from) throw new Error("--to goes with --from");
    for (const [k, d] of [["--from", from], ["--to", to]]) if (!DAY_RE.test(d) || Number.isNaN(toUtc(d))) throw new Error(`${k} wants a date as YYYY-MM-DD (got ${JSON.stringify(d)})`);
    const n = daysBetween(from, to);
    if (n < 0) throw new Error(`--to ${to} is before --from ${from}`);
    if (n > 13) throw new Error(`--from ${from} --to ${to}: at most 14 days`);
    const days = Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
    return { from, to, days, label: rangeLabel(from, to) };
  }
  let monday;
  if (from) {
    if (!DAY_RE.test(from) || Number.isNaN(toUtc(from))) throw new Error(`--from wants a date as YYYY-MM-DD (got ${JSON.stringify(from)})`);
    monday = addDays(from, -weekdayOf(from));
  } else {
    const today = localDay(now, tz);
    const wd = weekdayOf(today);
    monday = addDays(today, wd >= 4 ? 7 - wd : -wd);
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  return { from: monday, to: days[6], days, label: rangeLabel(monday, days[6]) };
}

const dayNum = (day) => Number(day.slice(8, 10));
const monthOf = (day) => MONTHS[Number(day.slice(5, 7)) - 1];
const dm = (day) => `${dayNum(day)} ${monthOf(day)}`;

/** «26 ott – 1 nov», «5–11 ott». */
export function rangeLabel(a, b) {
  return a.slice(0, 7) === b.slice(0, 7) ? `${dayNum(a)}–${dayNum(b)} ${monthOf(b)}` : `${dm(a)} – ${dm(b)}`;
}

/** «fino al 30 ott», «fino all'1 nov», «fino all'8 dic». */
export function untilLabel(day) {
  const n = dayNum(day);
  return `fino ${n === 1 || n === 8 || n === 11 ? "all'" : "al "}${dm(day)}`;
}

/** «30 e 31 ott», «31 ott e 1 nov», «29, 30 e 31 ott». */
export function listLabel(days) {
  if (days.length === 1) return `${WEEKDAYS[weekdayOf(days[0])]} ${dm(days[0])}`;
  const parts = days.map((d, i) => (i < days.length - 1 && d.slice(0, 7) === days[i + 1].slice(0, 7) ? String(dayNum(d)) : dm(d)));
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/* ── events ─────────────────────────────────────────────────────────────── */

/** Lowercase, no accents or punctuation, every dash the same, single spaces. */
export function normTitle(s) {
  return String(s || "")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function cleanText(s) {
  return String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** The venue without the town or a street already on the card: «Teatro Donnafugata, Via …» → «Teatro Donnafugata». */
export function venueOf(place = {}) {
  let name = cleanText(place.name);
  const town = cleanText(place.town);
  if (!name) return "";
  name = name.replace(new RegExp(`^${town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–,:]\\s*`, "i"), "");
  name = name.split(/,\s*(?=via|viale|piazza|corso|largo|contrada|c\.da)/i)[0].trim();
  if (normTitle(name) === normTitle(town)) return "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** One API event → the fields the selection needs. Pure. */
export function normalizeEvent(raw, cfg = EVENTS_DEFAULTS) {
  const start = String(raw.startsLocal || "");
  const end = raw.endsLocal ? String(raw.endsLocal) : null;
  const firstDay = start.slice(0, 10);
  const time = !raw.allDay && start.length >= 16 ? start.slice(11, 16) : null;
  const sourceIds = (raw.sources || []).map((s) => s.sourceId).filter(Boolean);
  let lastDay = firstDay;
  if (end && DAY_RE.test(end.slice(0, 10))) {
    lastDay = end.slice(0, 10);
    // an end at 00:00 is usually a date with no time: that day is the last one. Two exceptions:
    // the sources that write ends the iCal way (exclusive, the day after), and a show that runs
    // to midnight (00:00 the day after it starts)
    if (end.slice(11, 16) === "00:00" && lastDay > firstDay) {
      const exclusive = sourceIds.some((id) => (cfg.exclusiveEndSources || []).includes(id));
      if (exclusive || (!raw.allDay && lastDay === addDays(firstDay, 1))) lastDay = addDays(lastDay, -1);
    }
    if (lastDay < firstDay) lastDay = firstDay;
  }
  const source = (raw.sources || [])[0] || null;
  const town = cleanText(raw.place?.town);
  const title = stripTownPrefix(cleanText(raw.title), town);
  return {
    id: raw.id,
    title,
    key: normTitle(title),
    category: raw.category || "",
    town,
    venue: venueOf(raw.place),
    start, end, allDay: Boolean(raw.allDay), time,
    firstDay, lastDay,
    poster: raw.poster?.url ? { url: new URL(raw.poster.url, cfg.apiUrl).href, width: raw.poster.width || null, height: raw.poster.height || null } : null,
    source: source ? { id: source.sourceId || "", name: cleanText(source.name) } : null,
    sources: (raw.sources || []).map((s) => cleanText(s.name)).filter(Boolean),
    url: raw.url || null,
  };
}

/** «MODICA – Chocomodica, festival…» → «Chocomodica, festival…»: the town is on the card already. */
export function stripTownPrefix(title, town) {
  if (!town) return title;
  const re = new RegExp(`^${town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–—:|]\\s+`, "i");
  const out = title.replace(re, "");
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : title;
}

function compileTitles(list) {
  return (list || []).map((s) => (s instanceof RegExp ? s : new RegExp(s, "i")));
}

/** Why an event stays out, or null. */
export function exclusionReason(ev, cfg = EVENTS_DEFAULTS, titleRes = compileTitles(cfg.excludeTitles)) {
  if ((cfg.excludeCategories || []).includes(ev.category)) return `categoria ${ev.category}`;
  const hit = titleRes.find((re) => re.test(ev.title));
  if (hit) return `titolo /${hit.source}/`;
  const conf = compileTitles(cfg.excludeConferences).find((re) => re.test(ev.title));
  if (conf) return `convegno o conferenza (/${conf.source}/)`;
  if (!ev.town) return "senza comune";
  return null;
}

const STOPWORDS = new Set("di a da in con su per tra fra il lo la i gli le un uno una del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle sul sullo sulla sui sugli sulle e ed o the of and".split(" "));
const GENERIC = new Set("mostra mostre concerto concerti spettacolo spettacoli festa feste sagra sagre evento eventi incontro incontri presentazione rassegna festival teatro cinema film laboratorio visita visite convegno conferenza serata edizione inaugurazione apertura live musica".split(" "));

/** A title's words that tell it apart: no stopwords, numbers, single letters or the town. */
export function titleTokens(title, town = "") {
  const townWords = new Set(normTitle(town).split(" "));
  return new Set(normTitle(title).split(" ").filter((w) => w.length > 1 && !/^\d/.test(w) && !STOPWORDS.has(w) && !townWords.has(w)));
}

/**
 * Two listings of one event under different titles («ChocoModica 2026» and «Chocomodica,
 * festival del cioccolato modicano»): same town, overlapping days, and the shorter title's
 * words are (almost) all in the longer one, at least one of them not a generic word.
 */
export function sameEvent(a, b) {
  if (normTitle(a.town) !== normTitle(b.town)) return false;
  if (a.lastDay < b.firstDay || b.lastDay < a.firstDay) return false;
  const ta = titleTokens(a.title, a.town), tb = titleTokens(b.title, b.town);
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (!small.size) return false;
  const shared = [...small].filter((w) => big.has(w));
  return shared.length / small.size >= 0.75 && shared.some((w) => !GENERIC.has(w));
}

/**
 * Merge listings of one event into one card: the same title in the same town (a show on two
 * nights, a weekend exhibition listed as «-» and «–»), or a near-duplicate from another source
 * (`sameEvent`). The card takes the title of the best-sourced listing (most sources, then a
 * poster, then the earliest), keeps one occurrence per day and every source.
 */
export function mergeEvents(events) {
  const parent = events.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const join = (i, j) => { parent[root(i)] = root(j); };
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j];
      if ((a.key === b.key && normTitle(a.town) === normTitle(b.town)) || sameEvent(a, b)) join(i, j);
    }
  }
  const groups = new Map();
  events.forEach((ev, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(ev); });
  return [...groups.values()].map((list) => {
    const byStart = [...list].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    const primary = [...byStart].sort((a, b) => b.sources.length - a.sources.length || Number(Boolean(b.poster)) - Number(Boolean(a.poster)))[0];
    const days = new Set();
    const occurrences = [primary, ...byStart.filter((e) => e !== primary)]
      .filter((e) => (days.has(e.firstDay) ? false : days.add(e.firstDay)))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((e) => ({ id: e.id, firstDay: e.firstDay, lastDay: e.lastDay, time: e.time, allDay: e.allDay }));
    const withPoster = [primary, ...byStart].find((e) => e.poster);
    return {
      ...primary,
      ids: byStart.map((e) => e.id),
      primaryAllDay: primary.allDay,
      occurrences,
      firstDay: byStart.reduce((m, e) => (e.firstDay < m ? e.firstDay : m), primary.firstDay),
      lastDay: byStart.reduce((m, e) => (e.lastDay > m ? e.lastDay : m), primary.lastDay),
      category: primary.category || byStart.find((e) => e.category)?.category || "",
      venue: primary.venue || byStart.find((e) => e.venue)?.venue || "",
      poster: withPoster?.poster || null,
      source: withPoster?.source || primary.source,
      sources: [...new Set(byStart.flatMap((e) => e.sources))],
      url: primary.url || byStart.find((e) => e.url)?.url || null,
    };
  });
}

/** The days of the week the card is on (each occurrence clipped to the week). */
export function daysInWeek(ev, week) {
  const out = new Set();
  for (const o of ev.occurrences || [ev]) {
    for (let d = o.firstDay > week.from ? o.firstDay : week.from; d <= o.lastDay && d <= week.to; d = addDays(d, 1)) out.add(d);
  }
  return [...out].sort();
}

/**
 * The card's date block: `when` («ven 30 ott», «31 ott e 1 nov», «30 ott – 1 nov», «fino al
 * 30 ott») and `time` («20:30», «tutto il giorno», «sab 20:30 · dom 18:30», «in corso»).
 */
export function dateLabels(ev, week) {
  const occ = ev.occurrences || [ev];
  const days = daysInWeek(ev, week);
  const multiDay = occ.some((o) => o.lastDay > o.firstDay);
  if (ev.firstDay < week.from) return { when: untilLabel(ev.lastDay), time: "in corso", weekday: null };
  if (multiDay) {
    const span = daysBetween(ev.firstDay, ev.lastDay);
    const when = span === 1 ? listLabel([ev.firstDay, ev.lastDay]) : rangeLabel(ev.firstDay, ev.lastDay);
    const timed = occ.find((o) => o.time);
    const allDay = ev.primaryAllDay ?? occ.every((o) => o.allDay);
    return { when, time: allDay || !timed ? "tutto il giorno" : `dalle ${timed.time}`, weekday: null };
  }
  const times = [...new Set(occ.map((o) => o.time || ""))];
  const time = times.length === 1
    ? (times[0] || "tutto il giorno")
    : occ.map((o) => `${WEEKDAYS[weekdayOf(o.firstDay)]} ${o.time || "tutto il giorno"}`).join(" · ");
  return { when: listLabel(days), time, weekday: days.length === 1 ? WEEKDAYS_LONG[weekdayOf(days[0])] : null };
}

/** Base score before the town spread. Higher is better; every term is in cfg.weights. */
export function scoreEvent(ev, week, cfg = EVENTS_DEFAULTS) {
  const w = cfg.weights;
  const days = daysInWeek(ev, week);
  const startsInWeek = ev.firstDay >= week.from;
  const occ = ev.occurrences || [ev];
  let s = 0;
  if (ev.poster) s += w.poster;
  if (startsInWeek && occ.some((o) => o.time && o.time >= "18:00")) s += w.evening;
  if (days.some((d) => weekdayOf(d) >= 4)) s += w.weekend;
  s += cfg.categoryWeights[ev.category] || 0;
  if (startsInWeek) s += w.startsInWeek;
  if (daysBetween(ev.firstDay, ev.lastDay) > w.longSpanDays) s += w.longSpan;
  return s;
}

/** Chronological key for a card: its first day in the week, then its time (all-day first). */
function chronoKey(ev, week) {
  const day = ev.firstDay > week.from ? ev.firstDay : week.from;
  const t = ev.firstDay < week.from ? "" : (ev.occurrences || [ev])[0].time || "";
  return `${day} ${t.padEnd(5, " ")} ${ev.key} ${ev.id}`;
}

/**
 * The selection. Returns { chosen, candidates, excluded, merged, skip, reason }:
 *   1. events overlapping the week (lookback events that ended before it are dropped quietly);
 *      when the week holds `today`, the ones already over too;
 *   2. exclusions (category, title, no town) — listed with their reason;
 *   3. same title + town merged into one card;
 *   4. greedy pick by score, each pick in a town costing the next candidates there `sameTown`;
 *      ties go to the earlier event, then the title, then the id;
 *   5. the picks in chronological order. Fewer than `minEvents` → skip.
 */
export function selectEvents(rawEvents, cfg, { week, today = null } = {}) {
  const seen = new Set();
  const titleRes = compileTitles(cfg.excludeTitles);
  const excluded = [];
  const kept = [];
  for (const raw of rawEvents) {
    if (!raw?.id || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const ev = normalizeEvent(raw, cfg);
    if (!ev.firstDay || ev.lastDay < week.from || ev.firstDay > week.to) continue;
    if (today && today >= week.from && today <= week.to && ev.lastDay < today) { excluded.push({ ...ev, reason: "già passato" }); continue; }
    const reason = exclusionReason(ev, cfg, titleRes);
    if (reason) { excluded.push({ ...ev, reason }); continue; }
    kept.push(ev);
  }
  const merged = mergeEvents(kept);
  const candidates = merged.map((ev) => ({ ...ev, score: scoreEvent(ev, week, cfg) }));
  const pool = [...candidates].sort((a, b) => chronoKey(a, week).localeCompare(chronoKey(b, week)));
  const picked = [];
  const perTown = new Map();
  while (picked.length < cfg.maxEvents && pool.length) {
    let best = -1, bestScore = -Infinity;
    pool.forEach((ev, i) => {
      const s = ev.score - cfg.weights.sameTown * (perTown.get(ev.town) || 0);
      if (s > bestScore) { best = i; bestScore = s; }
    });
    const [ev] = pool.splice(best, 1);
    picked.push({ ...ev, adjusted: bestScore });
    perTown.set(ev.town, (perTown.get(ev.town) || 0) + 1);
  }
  const chosen = picked
    .sort((a, b) => chronoKey(a, week).localeCompare(chronoKey(b, week)))
    .map((ev) => ({ ...ev, ...dateLabels(ev, week), categoryLabel: categoryLabel(ev.category, cfg) }));
  const notPicked = pool.map((ev) => ({ ...ev, reason: `punteggio ${ev.score}, fuori dai ${cfg.maxEvents}` }));
  const duplicates = merged.filter((m) => m.ids.length > 1).map((m) => ({ ids: m.ids, title: m.title, merged: kept.filter((e) => m.ids.includes(e.id)).map((e) => e.title) }));
  const skip = chosen.length < cfg.minEvents;
  return {
    week, chosen, candidates: candidates.length, excluded, notPicked, duplicates, skip,
    reason: skip ? `solo ${chosen.length} event${chosen.length === 1 ? "o" : "i"} validi per ${week.label} (minimo ${cfg.minEvents}): reel non generato` : null,
  };
}

export function categoryLabel(cat, cfg = EVENTS_DEFAULTS) {
  const l = cfg.categoryLabels[cat ?? ""];
  if (l) return l;
  return cat ? cat.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) : cfg.categoryLabels[""] || "Evento";
}

/* ── network ────────────────────────────────────────────────────────────── */

async function getEvents(cfg, from, to, fetchImpl) {
  const url = new URL(cfg.apiUrl);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("limit", "1000");
  const res = await fetchImpl(url.href, { headers: { "User-Agent": "Mozilla/5.0 ziggy", Accept: "application/json" } });
  if (!res.ok) throw new Error(`events ${url.href} → ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body?.data)) throw new Error(`events ${url.href}: no data array`);
  return body.data;
}

/**
 * The week's events plus the ones that started up to `lookbackDays` earlier (exhibitions, runs
 * of shows): the API filters on the start, so a long event begun last month is only in the
 * second window. The selection keeps what overlaps the week.
 */
export async function fetchWeekEvents(cfg, week, { fetchImpl = fetch } = {}) {
  const inWeek = await getEvents(cfg, week.from, week.to, fetchImpl);
  const before = await getEvents(cfg, addDays(week.from, -cfg.lookbackDays), addDays(week.from, -1), fetchImpl);
  return [...inWeek, ...before];
}

const POSTER_EXT = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

/**
 * Download the chosen cards' posters into `<campaignDir>/posters/<id>.<ext>`. A poster that
 * cannot be fetched leaves its card typographic (it never blocks the reel); the error is kept.
 */
export async function downloadPosters(cards, campaignDir, { fetchImpl = fetch, log = () => {} } = {}) {
  const dir = join(campaignDir, "posters");
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const card of cards) {
    if (!card.poster?.url) { out.push({ ...card, posterFile: null }); continue; }
    try {
      const res = await fetchImpl(card.poster.url, { headers: { "User-Agent": "Mozilla/5.0 ziggy" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get("content-type") || "").split(";")[0].trim();
      const ext = POSTER_EXT[type] || (card.poster.url.match(/\.(webp|png|jpe?g)(?:\?|$)/i)?.[1] || "webp").toLowerCase().replace("jpeg", "jpg");
      const file = `posters/${card.id}.${ext}`;
      writeFileSync(join(campaignDir, file), Buffer.from(await res.arrayBuffer()));
      out.push({ ...card, posterFile: file });
    } catch (error) {
      log(`  poster ✗ ${card.title}: ${error.message} — typographic card`);
      out.push({ ...card, posterFile: null, posterError: error.message });
    }
  }
  return out;
}

/**
 * The existing alert path for messages that publish nothing: the shell command in
 * ZIGGY_REPORT_HOOK (what `ziggy serve` fires with each report), with the text in
 * ZIGGY_REPORT_TEXT. Without a hook nothing is sent. Resolves to true when the hook ran.
 */
export function runReportHook(slug, text, { hook = process.env.ZIGGY_REPORT_HOOK } = {}) {
  if (!hook) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", hook], { env: { ...process.env, ZIGGY_REPORT_TENANT: slug, ZIGGY_REPORT_TEXT: text }, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(true) : reject(new Error(`report hook exited ${code}`))));
  });
}

/* ── campaigns ──────────────────────────────────────────────────────────── */

/**
 * Reel timing: a 3 s intro, 2.6 s per event card, a 3.5 s outro; at least 15 s, at most 90 s
 * (a long week gets shorter cards, never fewer).
 */
export const CARD_SECONDS = 2.6;
export const MAX_REEL_SECONDS = 90;
export function eventsTimeline(n) {
  const intro = 3, outro = 3.5;
  const duration = Math.round(Math.max(15, Math.min(MAX_REEL_SECONDS, intro + outro + CARD_SECONDS * n)) * 10) / 10;
  const card = n ? Math.round(((duration - intro - outro) / n) * 1000) / 1000 : 0;
  return { intro, card, outro, duration };
}

const displayUrl = (url) => String(url).replace(/^https?:\/\//, "").replace(/\/$/, "");

export function weekCampaignName(week) {
  return `eventi-${week.from}`;
}

/** The weekly campaign. Pure: `cards` already carry `posterFile` (or null). */
export function weekCampaign(tenant, cfg, week, cards) {
  const t = eventsTimeline(cards.length);
  const [from, to] = [week.from, week.to];
  const fromMonth = MONTHS_LONG[Number(from.slice(5, 7)) - 1], toMonth = MONTHS_LONG[Number(to.slice(5, 7)) - 1];
  const longRange = fromMonth === toMonth ? `dal ${dayNum(from)} al ${dayNum(to)} ${toMonth}` : `dal ${dayNum(from)} ${fromMonth} al ${dayNum(to)} ${toMonth}`;
  const caption = weekCaption(cards, longRange, cfg);
  return {
    template: cfg.template,
    language: tenant.language || "it",
    duration: t.duration,
    intent: `Weekly events reel: ${week.label}`,
    week: { from, to, label: week.label, days: week.days || Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i)) },
    link: cfg.url,
    copy: {
      title: "Gli eventi in provincia di Ragusa della settimana",
      highlight: "Ragusa",
      kicker: week.label,
      cta: "Tutti gli eventi:",
      url: displayUrl(cfg.url),
      propose: "Organizzi qualcosa? Proponilo sul sito",
    },
    timing: { intro: t.intro, card: t.card, outro: t.outro },
    events: cards.map((c) => ({
      id: c.id, ids: c.ids, title: displayTitle(c.title),
      when: c.when, time: c.time, weekday: c.weekday, days: daysInWeek(c, week),
      category: c.category, categoryLabel: c.categoryLabel,
      town: c.town, venue: c.venue,
      poster: c.posterFile || null,
      credit: c.posterFile && c.source?.name ? `Locandina: ${c.source.name}` : "",
      sources: c.sources, url: c.url,
    })),
    audio: { bed: "news", volume: 0.6, swellAt: t.duration - t.outro, beats: [[0.4, 1318.5, 1.2, 0.07], [t.intro, 659.3, 1.4, 0.05], [t.duration - t.outro + 0.2, 987.8, 1.2, 0.05]] },
    // posted only by `ziggy events --week --publish` (eventspub.mjs) or a `ziggy post` by hand
    posts: {
      instagram_reel: { body: caption, media: "reel", cover: true },
      facebook_reel: { body: caption, media: "reel" },
    },
  };
}

/** Instagram cuts a caption at 2,200 characters; the list keeps under it. */
export const CAPTION_MAX = 2150;

/**
 * The reel's caption: every event as «Ven 23 ott, 18:00 · Modica, Teatro Garibaldi» + its title.
 * A week too long for Instagram drops the venues first, then the last events («e altri N»).
 */
export function weekCaption(cards, longRange, cfg) {
  const line = (c, venue) => {
    const where = [c.town, venue ? c.venue : ""].filter(Boolean).join(", ");
    return `${cap(c.when)}${c.time && c.time !== "in corso" ? `, ${c.time}` : ""} · ${where}\n${displayTitle(c.title)}`;
  };
  const build = (lines, more = 0) => [
    `Gli eventi della settimana in provincia di Ragusa, ${longRange}.`,
    ...lines,
    more ? `…e altri ${more} eventi sul sito.` : "",
    "Organizzi qualcosa? Proponilo sul sito.",
    cfg.hashtags || "",
    `Tutti gli eventi, aggiornati ogni giorno: ${cfg.url}`,
  ].filter(Boolean).join("\n\n");
  let text = build(cards.map((c) => line(c, true)));
  if (text.length <= CAPTION_MAX) return text;
  const short = cards.map((c) => line(c, false));
  for (let n = short.length; n > 0; n--) {
    text = build(short.slice(0, n), short.length - n);
    if (text.length <= CAPTION_MAX) return text;
  }
  return text;
}

/** The evergreen teaser: no dates, no event titles, so it can run as an ad at any time. */
export function teaserCampaign(tenant, cfg) {
  const caption = [
    "Che si fa a Ragusa? Concerti, mostre, teatro, sagre: il calendario degli eventi di tutta la provincia, aggiornato ogni giorno.",
    "Organizzi qualcosa? Proponilo sul sito.",
    cfg.hashtags || "",
    `Tutti gli eventi: ${cfg.url}`,
  ].filter(Boolean).join("\n\n");
  return {
    template: cfg.teaserTemplate,
    language: tenant.language || "it",
    duration: 13.5,
    intent: "Evergreen teaser for the events calendar (sponsorable: no dates, no event titles).",
    link: cfg.url,
    copy: {
      hook: "Che si fa a Ragusa?",
      highlight: "Ragusa?",
      lead: "Il calendario di",
      province: "In tutta la provincia",
      daily: "Aggiornato ogni giorno",
      cta: "Tutti gli eventi su",
      url: displayUrl(cfg.url),
      propose: "Organizzi qualcosa? Proponilo sul sito",
    },
    teaser: { categories: cfg.teaser.categories, towns: cfg.teaser.towns },
    audio: { bed: "news", volume: 0.6, swellAt: 10, beats: [[0.4, 1318.5, 1.2, 0.07], [3.2, 659.3, 1.4, 0.05], [10.2, 987.8, 1.2, 0.05]] },
    posts: {
      instagram_reel: { body: caption, media: "reel", cover: true },
      facebook_reel: { body: caption, media: "reel" },
    },
  };
}

/** Typographic dash between title parts: «Ai Nostri Tempi (biblici) - Ragusa…» → «… – Ragusa…». */
export function displayTitle(s) {
  return String(s || "").replace(/\s+[-–—]\s+/g, " – ");
}

function cap(s) {
  return String(s || "").replace(/^./, (c) => c.toUpperCase());
}

/* ── template tokens (video.mjs) ────────────────────────────────────────── */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Category → one of the brand's own colours for its chip. */
const CATEGORY_TONE = { "musica-live": "sea", cinema: "sea", teatro: "hot", danza: "hot", mostre: "lime", libri: "lime", natura: "lime", sagre: "sun", feste: "sun" };

/**
 * A title's starting size: long titles start smaller so three lines hold them; the template
 * still shrinks a title that wraps to a fourth line.
 */
export function titleSize(title, base) {
  const n = String(title).length;
  const k = n <= 24 ? 1 : n <= 40 ? 0.9 : n <= 60 ? 0.8 : n <= 80 ? 0.7 : 0.62;
  return Math.round(base * k);
}

/** «Ai Nostri Tempi (biblici) – Ragusa dietro il Sipario» stays whole; anything past 110 chars is cut at a word. */
export function clampTitle(title, max = 110) {
  const t = String(title);
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/** The days strip (a week, or the range shown): weekday initial + day number, `on` when a card falls on it. */
export function weekStrip(weekDays, onDays, cls) {
  const initials = ["L", "M", "M", "G", "V", "S", "D"];
  return weekDays.map((d) => `<div class="${cls}-day${onDays.has(d) ? " on" : ""}" data-day="${d}"><span class="${cls}-wd">${initials[weekdayOf(d)]}</span><span class="${cls}-n">${dayNum(d)}</span><i class="${cls}-dot"></i></div>`).join("");
}

/**
 * Words as `.w` spans for a staggered reveal; the ones matching `highlight` («Ragusa») get
 * `.hl`. A one-letter word travels with the next one («a Ragusa?»), so no line ends on it.
 */
export function wordSpans(text, highlight = "") {
  const hl = normTitle(highlight);
  const mark = (w) => (hl && normTitle(w) === hl ? `<span class="hl">${esc(w)}</span>` : esc(w));
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const glue = words[i].length === 1 && i < words.length - 1;
    out.push(`<span class="w">${mark(words[i])}${glue ? `&nbsp;${mark(words[++i])}` : ""}</span>`);
  }
  return out.join(" ");
}

/** Tokens for the eventi-* templates: `__EV_<NAME>__`. */
export function eventTemplateTokens({ campaign, v, posterSrcs = [], brand }) {
  const raw = brand.palette.raw || {};
  const tones = { sun: raw["--sun"] || brand.palette.accent, hot: raw["--hot"] || brand.palette.accent, lime: raw["--lime"] || brand.palette.accent, sea: raw["--sea"] || brand.palette.accent };
  const vars = Object.entries(v).filter(([, x]) => typeof x === "number").map(([k, x]) => `--v-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${x}px;`).join(" ");
  const base = {
    VARS: vars,
    SUN: tones.sun, HOT: tones.hot, LIME: tones.lime, SEA: tones.sea,
    CARD_BG: raw["--card"] || brand.palette.bg,
    NIGHT2: raw["--night-2"] || brand.palette.bg,
  };
  if (campaign.template === "eventi-teaser") {
    const t = campaign.teaser || EVENTS_DEFAULTS.teaser;
    const order = ["sun", "hot", "lime", "sea"];
    return {
      ...base,
      HOOK_WORDS: wordSpans(campaign.copy?.hook, campaign.copy?.highlight),
      DAILY_WORDS: wordSpans(campaign.copy?.daily),
      WORDS: (t.categories || []).map((w, i) => `<span class="tz-word tone-${order[i % order.length]}" id="${"__ID__"}-word-${i}">${esc(w)}</span>`).join(""),
      WORD_N: String((t.categories || []).length),
      TOWNS: [...(t.towns || []), ...(t.towns || [])].map((w) => `<span class="tz-town">${esc(w)}</span><i class="tz-sep"></i>`).join(""),
      GRID: Array.from({ length: 35 }, (_, i) => `<div class="tz-cell"><i class="tz-ring"></i><i class="tz-cdot tone-${order[(i * 7 + 3) % 4]}"></i></div>`).join(""),
    };
  }
  const events = Array.isArray(campaign.events) ? campaign.events : [];
  const week = campaign.week || {};
  const weekDays = Array.isArray(week.days) && week.days.length ? week.days
    : week.from ? Array.from({ length: week.to ? daysBetween(week.from, week.to) + 1 : 7 }, (_, i) => addDays(week.from, i)) : [];
  const allOn = new Set(events.flatMap((e) => e.days || []));
  const cards = events.map((e, i) => {
    const n = String(i + 1).padStart(2, "0");
    const src = posterSrcs[i];
    const tone = CATEGORY_TONE[e.category] || "sun";
    const firstDay = (e.days || [])[0] || week.from;
    const poster = src
      ? `<div class="ev-poster" data-layout-allow-overflow="true"><div class="ev-poster-bg" style="background-image: url('${src}')"></div><img class="ev-poster-img" src="${src}" alt="" /></div><p class="ev-credit">${esc(e.credit)}</p>`
      : `<div class="ev-poster ev-type"><span class="ev-type-n">${firstDay ? dayNum(firstDay) : ""}</span><span class="ev-type-m">${esc(firstDay ? MONTHS_LONG[Number(firstDay.slice(5, 7)) - 1] : "")}</span><span class="ev-type-wd">${esc(firstDay ? WEEKDAYS_LONG[weekdayOf(firstDay)] : "")}</span><div class="ev-type-grid">${weekStrip(weekDays, new Set(e.days || []), "ev-tg")}</div></div><p class="ev-credit"></p>`;
    // the town is the card's own line, big; the venue goes small under the title
    const town = e.town ? `<p class="ev-town">${esc(e.town)}</p>` : "";
    return `            <section class="ev-card${src ? "" : " no-poster"}" id="__ID__-card-${i}" data-days="${esc((e.days || []).join(","))}">
              ${poster}
              <div class="ev-text">
                ${town}
                <p class="ev-date"><span class="ev-when">${esc(e.when)}</span><span class="ev-time">${esc(e.time || "")}</span></p>
                <h2 class="ev-title" data-size="${titleSize(clampTitle(e.title), v.evTitle || 64)}" style="font-size: ${titleSize(clampTitle(e.title), v.evTitle || 64)}px">${esc(clampTitle(e.title))}</h2>
                <p class="ev-meta"><span class="ev-chip tone-${tone}">${esc(e.categoryLabel || "Evento")}</span>${e.venue ? `<span class="ev-where">${esc(e.venue)}</span>` : ""}</p>
              </div>
              <span class="ev-count">${n}<span class="ev-count-of"> / ${String(events.length).padStart(2, "0")}</span></span>
            </section>`;
  }).join("\n");
  const t = campaign.timing || eventsTimeline(events.length);
  return {
    ...base,
    CARDS: cards,
    N: String(events.length),
    DAYS: String(weekDays.length || 7),
    T_INTRO: String(t.intro), T_CARD: String(t.card), T_OUTRO: String(t.outro),
    TITLE_WORDS: wordSpans(campaign.copy?.title, campaign.copy?.highlight),
    STRIP: weekStrip(weekDays, allOn, "ev-ws"),
    MINI: weekStrip(weekDays, new Set(), "ev-ms"),
    RANGE: esc(String(campaign.copy?.kicker || "").toUpperCase()),
  };
}
