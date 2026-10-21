import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  EVENTS_DEFAULTS, addDays, clampTitle, dateLabels, eventTemplateTokens, eventsConfig, eventsTimeline, fetchWeekEvents, listLabel, localDay,
  mergeEvents, normTitle, normalizeEvent, rangeLabel, resolveWeek, weekStrip, exclusionReason, CAPTION_MAX, sameEvent, selectEvents, stripTownPrefix, teaserCampaign, untilLabel,
  venueOf, weekCampaign, weekdayOf, wordSpans,
} from "../scripts/events.mjs";
import { planWeekPublish, weekPublishText } from "../scripts/eventspub.mjs";
import { campaignRepetition, captionRepetition } from "../scripts/lint.mjs";
import { createClient } from "../scripts/postproxy.mjs";
import { resolveVariants, scaffold } from "../scripts/video.mjs";
import { API_KEY, makeWorld, runCli, startMockPostproxy } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;
const { loadTenant, fontsDir, logPost, readPostLog } = await import("../scripts/config.mjs");

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "events-2026-10-26.json"), "utf8")).data;
const CFG = eventsConfig({ slug: "ragusa", events: { exclusiveEndSources: ["ccn-antica-ibla-api"] } });
const WEEK = resolveWeek({ from: "2026-10-26" });
// the old selection (until Oct 2026): six cards, a town spread; still a valid tenant config
const LEGACY = { ...CFG, maxEvents: 6, weights: { ...CFG.weights, sameTown: 2 } };

/** A minimal API event: one day, a town, a source; override what the case needs. */
let seq = 0;
const ev = (o = {}) => ({
  id: `e_${++seq}`, title: `Evento ${seq}`, startsLocal: "2026-10-30T21:00", endsLocal: null, allDay: false, category: "teatro",
  place: { name: "Teatro", town: "Ragusa" }, sources: [{ sourceId: "src", name: "Fonte" }], poster: { url: "/v1/posters/p_1" }, ...o,
});

/* ── the week ───────────────────────────────────────────────────────────── */

test("week: Monday to Thursday shows the current week, Friday to Sunday the next one", () => {
  const monday = (iso) => resolveWeek({ now: new Date(iso), tz: "Europe/Rome" }).from;
  assert.equal(monday("2026-10-20T10:00:00Z"), "2026-10-19"); // Tuesday
  assert.equal(monday("2026-10-22T21:30:00Z"), "2026-10-19"); // Thursday 23:30 CEST
  assert.equal(monday("2026-10-22T22:30:00Z"), "2026-10-26"); // already Friday 00:30 in Rome
  assert.equal(monday("2026-10-23T12:00:00Z"), "2026-10-26"); // Friday
  assert.equal(monday("2026-10-26T08:00:00Z"), "2026-10-26"); // Monday
  assert.equal(monday("2026-10-29T12:00:00Z"), "2026-10-26"); // Thursday
});

test("week: the DST change on Sunday 25 October 2026 moves no day", () => {
  const monday = (iso) => resolveWeek({ now: new Date(iso), tz: "Europe/Rome" }).from;
  assert.equal(monday("2026-10-24T23:30:00Z"), "2026-10-26"); // Sunday 01:30 CEST
  assert.equal(monday("2026-10-25T00:30:00Z"), "2026-10-26"); // Sunday 02:30 CEST, half an hour before the switch
  assert.equal(monday("2026-10-25T01:30:00Z"), "2026-10-26"); // Sunday 02:30 CET, after it
  assert.equal(monday("2026-10-25T22:59:00Z"), "2026-10-26"); // Sunday 23:59 CET
  assert.equal(monday("2026-10-25T23:00:00Z"), "2026-10-26"); // Monday 00:00 CET: the current week
  assert.equal(localDay(new Date("2026-10-25T23:00:00Z"), "Europe/Rome"), "2026-10-26");
  const w = resolveWeek({ from: "2026-10-19" });
  assert.deepEqual(w.days, ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.equal(w.to, "2026-10-25");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(weekdayOf("2026-10-25"), 6);
});

test("week: --from snaps to its Monday; the range label crosses months", () => {
  assert.equal(resolveWeek({ from: "2026-10-29" }).from, "2026-10-26");
  assert.equal(resolveWeek({ from: "2026-11-01" }).from, "2026-10-26");
  assert.equal(resolveWeek({ from: "2026-10-26" }).to, "2026-11-01");
  assert.equal(WEEK.label, "26 ott – 1 nov");
  assert.equal(resolveWeek({ from: "2026-10-05" }).label, "5–11 ott");
  assert.equal(resolveWeek({ from: "2026-12-30" }).label, "28 dic – 3 gen");
  assert.throws(() => resolveWeek({ from: "26/10/2026" }), /YYYY-MM-DD/);
});

test("date labels: until, lists of days, ranges", () => {
  assert.equal(untilLabel("2026-10-30"), "fino al 30 ott");
  assert.equal(untilLabel("2026-11-01"), "fino all'1 nov");
  assert.equal(untilLabel("2026-12-08"), "fino all'8 dic");
  assert.equal(listLabel(["2026-10-30"]), "ven 30 ott");
  assert.equal(listLabel(["2026-10-30", "2026-10-31"]), "30 e 31 ott");
  assert.equal(listLabel(["2026-10-31", "2026-11-01"]), "31 ott e 1 nov");
  assert.equal(listLabel(["2026-10-29", "2026-10-30", "2026-10-31"]), "29, 30 e 31 ott");
  assert.equal(rangeLabel("2026-10-24", "2026-11-08"), "24 ott – 8 nov");
});

/* ── normalising ────────────────────────────────────────────────────────── */

test("titles normalise: case, accents, punctuation, every dash, Unicode bold", () => {
  assert.equal(normTitle("DAL LEGNO DI GEPPETTO AI LEGNI DI BARTOLINI - PINOCCHIO E GIUFÀ"), normTitle("Dal legno di Geppetto ai legni di Bartolini – Pinocchio e Giufà"));
  assert.equal(normTitle("Ai Nostri Tempi (biblici) - Ragusa"), "ai nostri tempi biblici ragusa");
  assert.equal(normTitle("𝐏𝐢𝐧𝐨𝐜𝐜𝐡𝐢𝐨  e   Giufà!"), "pinocchio e giufa");
  assert.equal(stripTownPrefix("MODICA – Chocomodica, festival", "Modica"), "Chocomodica, festival");
  assert.equal(stripTownPrefix("Modica jazz", "Modica"), "Modica jazz");
  assert.equal(venueOf({ name: "Teatro Donnafugata, Via Pietro Novelli, 3, Ragusa Ibla", town: "Ragusa" }), "Teatro Donnafugata");
  assert.equal(venueOf({ name: "RAGUSA - Cor Jesu", town: "Ragusa" }), "Cor Jesu");
  assert.equal(venueOf({ name: "Modica", town: "Modica" }), "");
});

test("end at 00:00: a date (inclusive), except iCal sources and shows running to midnight", () => {
  const n = (o) => normalizeEvent(ev(o), CFG);
  // «dal 30 ottobre all'1 novembre», written 2026-11-01T00:00
  assert.equal(n({ startsLocal: "2026-10-30T00:00", endsLocal: "2026-11-01T00:00", allDay: true }).lastDay, "2026-11-01");
  // the iCal source: «dal 31 ottobre al 1 novembre», written 2026-11-02T00:00
  assert.equal(n({ startsLocal: "2026-10-31T00:00", endsLocal: "2026-11-02T00:00", allDay: true, sources: [{ sourceId: "ccn-antica-ibla-api", name: "Antica Ibla" }] }).lastDay, "2026-11-01");
  // a concert until midnight stays on its night
  assert.equal(n({ startsLocal: "2026-10-30T21:30", endsLocal: "2026-10-31T00:00" }).lastDay, "2026-10-30");
  // an exhibition opening at 11:00, «dal 21 al 30 ottobre»
  assert.equal(n({ startsLocal: "2026-10-21T11:00", endsLocal: "2026-10-30T00:00" }).lastDay, "2026-10-30");
  assert.equal(n({ startsLocal: "2026-10-30T18:30", endsLocal: null }).time, "18:30");
  assert.equal(n({ startsLocal: "2026-10-30T00:00", allDay: true }).time, null);
  assert.equal(n({}).poster.url, "https://ragusa.buzz/v1/posters/p_1");
});

/* ── selection on the real week ─────────────────────────────────────────── */

test("the week of 26 October 2026, capped at six (old config): exclusions, merges, labels, time order", () => {
  const r = selectEvents(FIXTURE, LEGACY, { week: WEEK });
  assert.equal(r.skip, false);
  assert.deepEqual(r.chosen.map((c) => c.title), [
    "Mostra fotografica: 25 anni della Capitaneria di Porto di Pozzallo",
    "La mente è più vasta del cielo",
    "ChocoModica 2026",
    "Franca V.",
    "Arsura Darkvoid",
    "Ai Nostri Tempi (biblici) - Ragusa dietro il Sipario",
  ]);
  const by = Object.fromEntries(r.chosen.map((c) => [c.title.slice(0, 12), c]));
  // «-» and «–»: one card, both nights
  assert.equal(by["Ai Nostri Te"].ids.length, 2);
  assert.equal(by["Ai Nostri Te"].when, "31 ott e 1 nov");
  assert.equal(by["Ai Nostri Te"].time, "sab 20:30 · dom 18:30");
  // the same festival from two sources, under two titles
  assert.equal(by["ChocoModica "].ids.length, 2);
  assert.equal(by["ChocoModica "].when, "30 ott – 1 nov");
  assert.equal(by["ChocoModica "].time, "tutto il giorno");
  // an exhibition that opened before the week (the inauguration listing merged into it)
  assert.equal(by["Mostra fotog"].when, "fino al 30 ott");
  assert.equal(by["Mostra fotog"].time, "in corso");
  assert.equal(by["Mostra fotog"].ids.length, 2);
  // a weekly film series: only this week's screening
  assert.equal(by["La mente è p"].when, "gio 29 ott");
  assert.equal(by["La mente è p"].weekday, "giovedì");
  assert.equal(by["Franca V."].categoryLabel, "Teatro");
  assert.equal(by["Arsura Darkv"].categoryLabel, "Musica live");
  assert.ok(r.chosen.every((c) => c.poster));
  // spread: three towns, Ragusa not taking every slot
  assert.deepEqual([...new Set(r.chosen.map((c) => c.town))].sort(), ["Modica", "Pozzallo", "Ragusa"]);
  // what stayed out, and why
  const reasons = Object.fromEntries(r.excluded.map((e) => [e.title, e.reason]));
  assert.equal(reasons["Ritiro inizio Anno Sociale della Vita Consacrata"], "categoria religione");
  assert.equal(reasons["Percorsi formativi e di aggiornamento di Pastorale della Salute"], "categoria corsi");
  assert.ok(r.excluded.some((e) => e.title === "Cresime"));
  assert.ok(!r.excluded.some((e) => e.firstDay < "2026-10-26" && e.lastDay < "2026-10-26"), "events over before the week are dropped quietly");
  // the first weekend of the exhibition (24–25 Oct, iCal end 26 Oct 00:00) is not in this week
  assert.ok(![...r.chosen, ...r.notPicked].some((c) => c.ids?.includes("e_53857567d6d0")));
  assert.ok(r.notPicked.some((c) => /PINOCCHIO/.test(c.title)));
});

test("selection is deterministic: input order does not matter", () => {
  const a = selectEvents(FIXTURE, CFG, { week: WEEK }).chosen.map((c) => c.id);
  const b = selectEvents([...FIXTURE].reverse(), CFG, { week: WEEK }).chosen.map((c) => c.id);
  assert.deepEqual(a, b);
});

test("filters: categories, title patterns, no town — all configurable", () => {
  const list = [
    ev({ title: "Cresime degli adulti", category: "" }),
    ev({ title: "Seduta del consiglio comunale", category: "" }),
    ev({ title: "Messa", category: "religione" }),
    ev({ title: "Concerto in piazza", place: { name: "", town: "" } }),
    ev({ title: "Corso di ceramica", category: "corsi" }),
  ];
  const r = selectEvents(list, { ...CFG, minEvents: 0 }, { week: WEEK });
  assert.equal(r.chosen.length, 0);
  assert.deepEqual(r.excluded.map((e) => e.reason), ["titolo /cresim/", "titolo /consiglio comunale/", "categoria religione", "senza comune", "categoria corsi"]);
  const open = selectEvents(list, { ...CFG, minEvents: 0, excludeCategories: [], excludeTitles: [] }, { week: WEEK });
  assert.equal(open.chosen.length, 4);
});

test("merge: recurrences of one title, near-duplicates from two sources; different events stay apart", () => {
  const n = (o) => normalizeEvent(ev(o), CFG);
  const nights = mergeEvents([n({ title: "Amleto - Teatro", startsLocal: "2026-10-30T21:00" }), n({ title: "AMLETO – teatro", startsLocal: "2026-10-31T21:00" }), n({ title: "Amleto – teatro", startsLocal: "2026-10-31T21:00", place: { town: "Modica" } })]);
  assert.equal(nights.length, 2, "same title in another town is another card");
  const ragusa = nights.find((m) => m.town === "Ragusa");
  assert.equal(dateLabels(ragusa, WEEK).when, "30 e 31 ott");
  assert.equal(dateLabels(ragusa, WEEK).time, "21:00");
  assert.equal(sameEvent(n({ title: "ChocoModica 2026", place: { town: "Modica" } }), n({ title: "Chocomodica, festival del cioccolato modicano", place: { town: "Modica" } })), true);
  assert.equal(sameEvent(n({ title: "Mostra di Salvatore Fratantonio" }), n({ title: "Mostra di Rosario Tumino" })), false);
  assert.equal(sameEvent(n({ title: "Concerto" }), n({ title: "Concerto di Natale" })), false, "generic words alone never merge");
  assert.equal(sameEvent(n({ title: "Jazz al Lucernaio", startsLocal: "2026-10-27T21:00" }), n({ title: "Jazz al Lucernaio live", startsLocal: "2026-10-30T21:00" })), false, "near-duplicates must share a day");
});

test("multi-day events from before the week: kept if they overlap it, dropped if over", () => {
  const list = [
    ev({ title: "Mostra lunga", category: "mostre", startsLocal: "2026-09-20T10:00", endsLocal: "2026-11-08T19:00" }),
    ev({ title: "Mostra finita", category: "mostre", startsLocal: "2026-09-20T10:00", endsLocal: "2026-10-25T19:00" }),
    ev({ title: "Mostra nuova", category: "mostre", startsLocal: "2026-10-28T10:00", endsLocal: "2026-11-08T19:00" }),
  ];
  const r = selectEvents(list, { ...CFG, minEvents: 0 }, { week: WEEK });
  const when = Object.fromEntries(r.chosen.map((c) => [c.title, c.when]));
  assert.deepEqual(Object.keys(when).sort(), ["Mostra lunga", "Mostra nuova"]);
  assert.equal(when["Mostra lunga"], "fino all'8 nov");
  assert.equal(when["Mostra nuova"], "28 ott – 8 nov");
});

test("default: every event of the week, one card each, in time order; conferences out", () => {
  const r = selectEvents(FIXTURE, CFG, { week: WEEK });
  assert.equal(r.chosen.length, 11);
  assert.equal(r.notPicked.length, 0, "no cap reached, no town spread");
  assert.ok(r.chosen.some((c) => /PINOCCHIO/.test(c.title)));
  assert.ok(r.chosen.some((c) => c.title === "In viaggio con i Cabrera"));
  const conv = r.excluded.find((e) => /^Ciclo di conversazioni/.test(e.title));
  assert.match(conv.reason, /^convegno o conferenza/);
  const firstDays = r.chosen.map((c) => (c.firstDay > WEEK.from ? c.firstDay : WEEK.from));
  assert.deepEqual(firstDays, [...firstDays].sort(), "chronological");
  for (const title of ["Convegno sul centro storico", "Conferenza stampa", "Seminario di diritto", "Tavola rotonda sul porto", "Workshop per commercialisti", "II Meeting regionale degli Iblei"]) {
    assert.match(String(exclusionReason({ title, town: "Ragusa", category: "altro" }, CFG)), /convegno o conferenza/, title);
  }
  for (const title of ["Presentazione del libro di Carmelo Sardo", "Sagra della ricotta", "Back to Nature Party", "Galà di apertura"]) {
    assert.equal(exclusionReason({ title, town: "Ragusa", category: "altro" }, CFG), null, title);
  }
});

test("town spread: a town already picked costs the next candidate there", () => {
  const list = [
    ...Array.from({ length: 7 }, (_, i) => ev({ title: `Concerto Ragusa ${i}`, category: "musica-live", startsLocal: `2026-10-${30 + (i % 2)}T21:0${i}` })),
    ev({ title: "Sagra a Scicli", category: "sagre", startsLocal: "2026-10-28T10:00", place: { name: "", town: "Scicli" } }),
  ];
  const spread = selectEvents(list, LEGACY, { week: WEEK }).chosen;
  assert.equal(spread.length, 6);
  assert.ok(spread.some((c) => c.town === "Scicli"));
  const flat = selectEvents(list, { ...LEGACY, weights: { ...LEGACY.weights, sameTown: 0 } }, { week: WEEK }).chosen;
  assert.ok(!flat.some((c) => c.town === "Scicli"), "without the spread the stronger Ragusa nights win");
});

test("max and min: at most maxEvents cards; fewer than minEvents is a skip", () => {
  const three = [ev({ title: "Uno" }), ev({ title: "Due", startsLocal: "2026-10-31T21:00" }), ev({ title: "Tre", startsLocal: "2026-11-01T18:00" })];
  assert.equal(selectEvents(three, { ...CFG, maxEvents: 2 }, { week: WEEK }).chosen.length, 2);
  assert.equal(EVENTS_DEFAULTS.maxEvents, 40, "the cap only guards the reel length");
  const ok = selectEvents(three, CFG, { week: WEEK });
  assert.equal(ok.skip, false);
  const few = selectEvents(three.slice(0, 2), CFG, { week: WEEK });
  assert.equal(few.skip, true);
  assert.match(few.reason, /solo 2 eventi validi per 26 ott – 1 nov \(minimo 3\)/);
});

test("the current week drops what is already over", () => {
  const list = [ev({ title: "Lunedì", startsLocal: "2026-10-26T21:00" }), ev({ title: "Venerdì", startsLocal: "2026-10-30T21:00" })];
  const r = selectEvents(list, { ...CFG, minEvents: 0 }, { week: WEEK, today: "2026-10-28" });
  assert.deepEqual(r.chosen.map((c) => c.title), ["Venerdì"]);
  assert.equal(r.excluded[0].reason, "già passato");
});

test("fetchWeekEvents reads the week and the 45 days before it", async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, json: async () => ({ data: [{ id: url.includes("2026-09-11") ? "old" : "new" }] }) }; };
  const list = await fetchWeekEvents(CFG, WEEK, { fetchImpl });
  assert.deepEqual(list.map((e) => e.id), ["new", "old"]);
  assert.match(urls[0], /from=2026-10-26&to=2026-11-01&limit=1000/);
  assert.match(urls[1], /from=2026-09-11&to=2026-10-25&limit=1000/);
});

/* ── campaigns and templates ───────────────────────────────────────────── */

test("the weekly campaign: copy, timing, captions ending with the calendar url, nothing a live loop reads", () => {
  const r = selectEvents(FIXTURE, LEGACY, { week: WEEK });
  const cards = r.chosen.map((c, i) => ({ ...c, posterFile: i === 1 ? null : `posters/${c.id}.webp` }));
  const c = weekCampaign({ name: "Ragusa Buzz", language: "it" }, CFG, WEEK, cards);
  assert.equal(c.template, "eventi-settimana");
  assert.equal(c.duration, 22.1);
  assert.deepEqual(c.timing, { intro: 3, card: 2.6, outro: 3.5 });
  assert.equal(c.copy.title, "Gli eventi in provincia di Ragusa della settimana");
  assert.deepEqual(c.week.days, WEEK.days);
  assert.equal(c.copy.kicker, "26 ott – 1 nov");
  assert.equal(c.copy.url, "ragusa.buzz/eventi");
  assert.equal(c.copy.headline, undefined, "the daily loop's coverage reads copy.headline: an events reel must not cover a story");
  assert.equal(c.story, undefined);
  assert.equal(c.audio.bed, "news");
  assert.equal(c.audio.jingle, undefined, "no jingle rotation is consumed");
  assert.deepEqual(Object.keys(c.posts).sort(), ["facebook_reel", "instagram_reel"]);
  for (const p of Object.values(c.posts)) {
    assert.ok(p.body.endsWith("https://ragusa.buzz/eventi"), p.body.slice(-60));
    assert.equal(p.media, "reel");
    assert.match(p.body, /Ai Nostri Tempi \(biblici\) – Ragusa dietro il Sipario/);
  }
  assert.equal(c.events[0].credit, "Locandina: Ragusa Oggi - Eventi");
  assert.equal(c.events[1].poster, null);
  assert.equal(c.events[1].credit, "", "no poster, no credit line");
  assert.deepEqual(c.events[5].days, ["2026-10-31", "2026-11-01"]);
  assert.equal(eventsTimeline(3).duration, 15);
  assert.equal(eventsTimeline(10).duration, 32.5);
  assert.equal(eventsTimeline(21).duration, 61.1);
  assert.deepEqual(eventsTimeline(40), { intro: 3, card: 2.088, outro: 3.5, duration: 90 }, "a long week: shorter cards, never past 90 s");
});

test("a custom range: exact days, not snapped; strip, kicker and caption follow it", () => {
  const w = resolveWeek({ from: "2026-10-21", to: "2026-10-25" });
  assert.deepEqual(w, { from: "2026-10-21", to: "2026-10-25", days: ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"], label: "21–25 ott" });
  assert.throws(() => resolveWeek({ to: "2026-10-25" }), /--to goes with --from/);
  assert.throws(() => resolveWeek({ from: "2026-10-25", to: "2026-10-21" }), /before/);
  assert.throws(() => resolveWeek({ from: "2026-10-01", to: "2026-10-25" }), /at most 14 days/);
  assert.throws(() => resolveWeek({ from: "2026-10-21", to: "25/10" }), /--to wants a date/);
  assert.equal(weekStrip(w.days, new Set(["2026-10-23"]), "x").match(/x-wd">(.)</g).map((m) => m.slice(-2, -1)).join(""), "MGVSD");
  const cards = [ev({ title: "Sogni e passioni", startsLocal: "2026-10-24T21:00", place: { name: "Teatro Garibaldi", town: "Modica" } })]
    .map((raw) => normalizeEvent(raw, CFG)).map((e) => ({ ...e, ...dateLabels(e, w), categoryLabel: "Musica live", posterFile: null }));
  const c = weekCampaign({ name: "Ragusa Buzz", language: "it" }, CFG, w, cards);
  assert.equal(c.copy.kicker, "21–25 ott");
  assert.match(c.posts.instagram_reel.body, /^Gli eventi della settimana in provincia di Ragusa, dal 21 al 25 ottobre\./);
  assert.match(c.posts.instagram_reel.body, /Sab 24 ott, 21:00 · Modica, Teatro Garibaldi\nSogni e passioni/);
  const tok = eventTemplateTokens({ campaign: c, v: { evTitle: 76 }, brand: RAGUSA_BRAND });
  assert.equal(tok.DAYS, "5");
  assert.equal((tok.STRIP.match(/ev-ws-day/g) || []).length, 5);
  assert.match(tok.CARDS, /<p class="ev-town">Modica<\/p>/);
  assert.match(tok.CARDS, /<span class="ev-where">Teatro Garibaldi<\/span>/);
});

test("the caption stays under Instagram's limit: venues go first, then the last events", () => {
  const w = resolveWeek({ from: "2026-10-26" });
  const many = Array.from({ length: 40 }, (_, i) => ({ title: `Un evento con un titolo abbastanza lungo numero ${i}`, town: "Santa Croce Camerina", venue: "Una sala dal nome piuttosto lungo e articolato", when: "sab 31 ott", time: "21:00" }));
  const body = weekCampaign({ name: "Ragusa Buzz", language: "it" }, CFG, w, many).posts.instagram_reel.body;
  assert.ok(body.length <= CAPTION_MAX, String(body.length));
  assert.doesNotMatch(body, /Una sala dal nome/);
  assert.match(body, /…e altri \d+ eventi sul sito\./);
  assert.ok(body.endsWith("https://ragusa.buzz/eventi"));
});

test("caption lint: the weekly list is not linted (its lines share venues by design), the teaser is", () => {
  const r = selectEvents(FIXTURE, CFG, { week: WEEK });
  const c = weekCampaign({ name: "Ragusa Buzz", language: "it" }, CFG, WEEK, r.chosen);
  // two shows at Teatro Donnafugata: as sentences, their lines would read as a repetition
  assert.equal(captionRepetition(c.posts.instagram_reel.body).ok, false);
  assert.deepEqual(campaignRepetition(c), { ok: true, skipped: "list caption", pairs: [] });
  assert.deepEqual(campaignRepetition(teaserCampaign({ name: "Ragusa Buzz", language: "it" }, CFG)), { ok: true, pairs: [] });
});

test("the teaser campaign is evergreen: no dates, no event titles, the calendar url", () => {
  const c = teaserCampaign({ name: "Ragusa Buzz", language: "it" }, CFG);
  assert.equal(c.template, "eventi-teaser");
  assert.ok(c.duration >= 12 && c.duration <= 15);
  const text = JSON.stringify(c.copy) + c.posts.instagram_reel.body;
  assert.doesNotMatch(text, /\b(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\b|\b20\d\d\b|gratis|gratuit|free/i);
  assert.equal(c.copy.hook, "Che si fa a Ragusa?");
  assert.deepEqual(c.teaser.categories, ["concerti", "mostre", "teatro", "sagre"]);
  assert.ok(c.teaser.towns.includes("Santa Croce"));
  assert.ok(c.posts.facebook_reel.body.endsWith("https://ragusa.buzz/eventi"));
});

test("word spans: highlight a word, keep one-letter words with the next", () => {
  assert.equal(wordSpans("Che si fa a Ragusa?", "Ragusa?"), '<span class="w">Che</span> <span class="w">si</span> <span class="w">fa</span> <span class="w">a&nbsp;<span class="hl">Ragusa?</span></span>');
  assert.match(wordSpans("Gli eventi di Ragusa", "Ragusa"), /<span class="w"><span class="hl">Ragusa<\/span><\/span>/);
  assert.equal(clampTitle("x ".repeat(80)).length <= 111, true);
});

/* ── HyperFrames projects ──────────────────────────────────────────────── */

const RAGUSA_BRAND = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "tenants", "ragusa", "brand.json"), "utf8"));

function eventsTenant(slug, extra = {}) {
  const dir = join(world.repo, "tenants", slug);
  mkdirSync(join(dir, "campaigns"), { recursive: true });
  writeFileSync(join(dir, "tenant.json"), JSON.stringify({ name: "Ragusa Buzz", site: "https://ragusa.buzz/", language: "it", postproxy: {}, ...extra }));
  writeFileSync(join(dir, "brand.json"), JSON.stringify(RAGUSA_BRAND));
  mkdirSync(fontsDir(slug), { recursive: true });
  for (const f of ["BricolageGrotesque", "BeVietnamPro", "GeistMono"]) writeFileSync(join(fontsDir(slug), `${f}.woff2`), Buffer.alloc(64, 0));
  return dir;
}

test("scaffold: the weekly template gets one card per event, posters, credits, the week strip; no token left", async () => {
  const dir = eventsTenant("evscaf");
  const r = selectEvents(FIXTURE, LEGACY, { week: WEEK });
  const campDir = join(dir, "campaigns", "eventi-2026-10-26");
  mkdirSync(join(campDir, "posters"), { recursive: true });
  const cards = r.chosen.map((c, i) => {
    if (i === 1) return { ...c, posterFile: null };
    writeFileSync(join(campDir, "posters", `${c.id}.webp`), Buffer.from("RIFF0000WEBP"));
    return { ...c, posterFile: `posters/${c.id}.webp` };
  });
  const campaign = { ...weekCampaign({ name: "Ragusa Buzz", language: "it" }, CFG, WEEK, cards), name: "eventi-2026-10-26", dir: campDir };
  const variants = resolveVariants(campaign);
  assert.deepEqual(Object.keys(variants), ["reel", "post"]);
  const projects = await scaffold({ tenant: loadTenant("evscaf"), campaign, variants, outRoot: join(world.root, "ev-videos") });
  for (const p of projects) {
    const sub = readFileSync(join(p.dir, "compositions", `${p.id}.html`), "utf8");
    assert.doesNotMatch(sub, /__[A-Z][A-Z0-9_]*__/, "every token is filled");
    assert.equal((sub.match(/<section class="ev-card/g) || []).length, 6);
    assert.equal((sub.match(/<p class="ev-town">/g) || []).length, 6, "every card names its town");
    assert.match(sub, /--days: 7;/);
    assert.equal((sub.match(/ev-card no-poster/g) || []).length, 1);
    assert.match(sub, /Locandina: Antica Ibla - Centro Commerciale Naturale/);
    assert.match(sub, /31 ott e 1 nov/);
    assert.match(sub, /var N = 6;/);
    assert.match(sub, /--v-poster-h: \d+px;/);
    assert.match(sub, /<span class="hl">Ragusa<\/span>|class="w hl"|<span class="w"><span class="hl">Ragusa/);
    assert.match(sub, /--sea: #3ddcff;/, "brand colours only");
    assert.match(sub, /<audio id="eventi-settimana-[a-z]+-bed" src="assets\/bed.wav"/);
    assert.match(sub, /id="eventi-settimana-[a-z]+-outro-kicker">26 OTT – 1 NOV</, "the last frame (the cover) names the week");
    const assets = readdirSync(join(p.dir, "assets"));
    assert.deepEqual(assets.filter((f) => f.startsWith("poster-")).sort(), ["poster-01.webp", "poster-03.webp", "poster-04.webp", "poster-05.webp", "poster-06.webp"]);
  }
});

test("scaffold: the teaser template carries the words, the towns and the grid", async () => {
  eventsTenant("evteas");
  const campaign = { ...teaserCampaign({ name: "Ragusa Buzz", language: "it" }, CFG), name: "eventi-teaser" };
  const projects = await scaffold({ tenant: loadTenant("evteas"), campaign, variants: resolveVariants(campaign), outRoot: join(world.root, "teaser-videos") });
  assert.deepEqual(projects.map((p) => p.variant), ["reel", "post"]);
  const sub = readFileSync(join(projects[0].dir, "compositions", "eventi-teaser-reel.html"), "utf8");
  assert.doesNotMatch(sub, /__[A-Z][A-Z0-9_]*__/);
  for (const w of ["concerti", "mostre", "teatro", "sagre", "Santa Croce", "Pozzallo", "ragusa.buzz/eventi", "Organizzi qualcosa? Proponilo sul sito", "Aggiornato"]) assert.match(sub, new RegExp(w.replace(/[.?]/g, "\\$&")));
  assert.equal((sub.match(/class="tz-cell"/g) || []).length, 35);
  assert.match(sub, /id="eventi-teaser-reel-cta-hook"><span class="w">Che<\/span>/, "the end card repeats the hook");
  const tokens = eventTemplateTokens({ campaign, v: { w: 1, h: 1 }, brand: RAGUSA_BRAND });
  assert.equal(tokens.WORD_N, "4");
});

/* ── the CLI, against a local events API ───────────────────────────────── */

let api;
before(async () => {
  const hits = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    hits.push(url.pathname + url.search);
    if (url.pathname.startsWith("/v1/posters/")) { res.writeHead(200, { "content-type": "image/webp" }); return res.end(Buffer.from("RIFF0000WEBPVP8 ")); }
    if (url.pathname === "/v1/events") {
      const from = url.searchParams.get("from"), to = url.searchParams.get("to");
      const set = url.searchParams.get("set") || api.set;
      const data = (set === "few" ? FIXTURE.filter((e) => /Franca|Arsura/.test(e.title)) : FIXTURE).filter((e) => e.startsLocal.slice(0, 10) >= from && e.startsLocal.slice(0, 10) <= to);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data, meta: { count: data.length } }));
    }
    res.writeHead(404); res.end();
  });
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  api = { base: `http://127.0.0.1:${server.address().port}`, hits, set: "all", close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
  eventsTenant("evcli", { events: { apiUrl: `${api.base}/v1/events`, url: "https://ragusa.buzz/eventi", exclusiveEndSources: ["ccn-antica-ibla-api"] } });
});
after(() => api?.close());

test("cli: --dry-run prints the selection and writes nothing", async () => {
  const r = await runCli(["events", "evcli", "--week", "--from", "2026-10-28", "--dry-run", "--json"], world.env);
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.week.from, "2026-10-26");
  assert.equal(d.campaign, "eventi-2026-10-26");
  assert.equal(d.chosen.length, 11);
  assert.ok(d.excluded.length > 0);
  assert.equal(existsSync(join(world.repo, "tenants", "evcli", "campaigns", "eventi-2026-10-26")), false);
  assert.ok(api.hits.some((h) => h.includes("from=2026-09-11&to=2026-10-25")));
});

test("cli: --from --to is an exact range: its own campaign name, not the week's Monday", async () => {
  const r = await runCli(["events", "evcli", "--week", "--from", "2026-10-28", "--to", "2026-11-01", "--dry-run", "--json"], world.env);
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.week.from, "2026-10-28");
  assert.equal(d.week.label, "28 ott – 1 nov");
  assert.equal(d.campaign, "eventi-2026-10-28");
  assert.ok(d.chosen.every((c) => c.lastDay >= "2026-10-28"));
  const bad = await runCli(["events", "evcli", "--week", "--to", "2026-11-01", "--dry-run"], world.env);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--to goes with --from/);
});

test("cli: --no-render writes the campaign and downloads the posters; --force to redo", async () => {
  const r = await runCli(["events", "evcli", "--week", "--from", "2026-10-26", "--no-render"], world.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /campaign eventi-2026-10-26 →/);
  assert.match(r.stdout, /nothing was posted/);
  const dir = join(world.repo, "tenants", "evcli", "campaigns", "eventi-2026-10-26");
  const c = JSON.parse(readFileSync(join(dir, "campaign.json"), "utf8"));
  assert.equal(c.events.length, 11);
  for (const e of c.events) {
    assert.match(e.poster, /^posters\/e_[0-9a-f]+\.webp$/);
    assert.ok(existsSync(join(dir, e.poster)));
    assert.match(e.credit, /^Locandina: /);
  }
  assert.ok(c.posts.instagram_reel.body.endsWith("https://ragusa.buzz/eventi"));
  const again = await runCli(["events", "evcli", "--week", "--from", "2026-10-26", "--no-render"], world.env);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists/);
  const forced = await runCli(["events", "evcli", "--week", "--from", "2026-10-26", "--no-render", "--force"], world.env);
  assert.equal(forced.status, 0, forced.stderr);
});

test("cli: renders reel and post through the HyperFrames CLI, nothing else", async () => {
  const fake = join(world.root, "fakehf-events");
  mkdirSync(fake, { recursive: true });
  const bin = join(fake, "hyperframes");
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const [cmd, ...rest] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(fake, "calls.log"))}, cmd + "\\n");
if (cmd === "check") { console.log("ok"); process.exit(0); }
if (cmd === "render") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, "mp4"); process.exit(0); }
if (cmd === "snapshot") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(o, { recursive: true }); fs.writeFileSync(path.join(o, "frame-00-at-1s.png"), "png"); process.exit(0); }
process.exit(1);
`, { mode: 0o755 });
  const r = await runCli(["events", "evcli", "--teaser", "--json"], { ...world.env, ZIGGY_HYPERFRAMES_BIN: bin });
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(d.manifest.outputs), ["reel", "post"]);
  assert.match(d.manifest.outputs.reel.video, /evcli-eventi-teaser-reel-1080x1920\.mp4$/);
  assert.match(d.manifest.outputs.post.video, /evcli-eventi-teaser-post-1080x1350\.mp4$/);
  assert.deepEqual(readFileSync(join(fake, "calls.log"), "utf8").trim().split("\n"), ["check", "render", "snapshot", "check", "render", "snapshot"]);
});

test("cli: fewer than minEvents → skip, exit 3; --notify goes through ZIGGY_REPORT_HOOK only when set", async () => {
  api.set = "few";
  try {
    const plain = await runCli(["events", "evcli", "--week", "--from", "2026-10-26", "--notify"], { ...world.env, ZIGGY_REPORT_HOOK: "" });
    assert.equal(plain.status, 3);
    assert.match(plain.stdout, /⏭️ Ragusa Buzz · solo 2 eventi validi per 26 ott – 1 nov \(minimo 3\): reel non generato/);
    assert.match(plain.stdout, /no ZIGGY_REPORT_HOOK: printed only/);
    const out = join(world.root, "hook.txt");
    const hooked = await runCli(["events", "evcli", "--week", "--from", "2026-10-26", "--notify", "--json"], { ...world.env, ZIGGY_REPORT_HOOK: `printf '%s|%s' "$ZIGGY_REPORT_TENANT" "$ZIGGY_REPORT_TEXT" > ${out}` });
    assert.equal(hooked.status, 3);
    assert.equal(JSON.parse(hooked.stdout).notified, true);
    assert.match(readFileSync(out, "utf8"), /^evcli\|⏭️ Ragusa Buzz · solo 2 eventi/);
    assert.equal(existsSync(join(world.repo, "tenants", "evcli", "campaigns", "eventi-2026-10-26", "skip")), false);
  } finally {
    api.set = "all";
  }
});

test("cli: a tenant without an events block has no events command", async () => {
  const r = await runCli(["events", "acme", "--week", "--dry-run"], world.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no events block/);
  assert.deepEqual(eventsConfig({ slug: "x", events: {} }).excludeCategories, EVENTS_DEFAULTS.excludeCategories);
});

/* ── --publish: live, now, on daily.only, Facebook through the Page guard ── */

let pp, bins;
const MON = "2026-10-26T06:00:00Z"; // Monday 07:00 in Rome, the first day after the DST change
const BLOCK = { platform: "facebook", status: "failed", error: "You're temporarily blocked from this action", error_details: { platform_error_code: "368" } };
before(async () => {
  pp = await startMockPostproxy({ profiles: [
    { id: "prof_ig", name: "Ragusa Buzz", platform: "instagram", status: "active", profile_group_id: "grp_1" },
    { id: "prof_fb", name: "Ragusa Buzz Page", platform: "facebook", status: "active", profile_group_id: "grp_1" },
  ] });
  bins = join(world.root, "fakebin-events-publish");
  mkdirSync(bins, { recursive: true });
  const write = (name, body) => writeFileSync(join(bins, name), body, { mode: 0o755 });
  write("hyperframes", `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const [cmd, ...rest] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(bins, "calls.log"))}, cmd + "\\n");
if (cmd === "check") { console.log("ok"); process.exit(0); }
if (cmd === "render") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, "mp4"); process.exit(0); }
if (cmd === "snapshot") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(o, { recursive: true }); fs.writeFileSync(path.join(o, "frame-00-at-1s.png"), "png"); process.exit(0); }
process.exit(1);
`);
  write("ffprobe", `#!/usr/bin/env node
const a = process.argv.slice(2).join(" ");
if (a.includes("format=duration")) console.log("18.4");
else if (a.includes("stream=codec_name")) console.log(process.env.FAKE_AUDIO === "none" ? "" : "aac");
`);
  write("ffmpeg", `#!/usr/bin/env node
console.error("[Parsed_volumedetect_0] mean_volume: -19.5 dB");
`);
});
after(() => pp?.close());

const pubTenant = (slug, facebook = { maxPerDay: 3, minGapMinutes: 240, pauseHours: 48 }) => eventsTenant(slug, {
  postproxy: { profileGroupId: "grp_1", profileIds: ["prof_ig", "prof_fb"], facebookPageId: "1406" },
  daily: { tz: "Europe/Rome", only: ["instagram_reel", "facebook_reel"], facebook },
  events: { apiUrl: `${api.base}/v1/events`, url: "https://ragusa.buzz/eventi", exclusiveEndSources: ["ccn-antica-ibla-api"] },
});
const PUB_ENV = (extra = {}) => ({
  ...world.env, ZIGGY_POSTPROXY_BASE_URL: pp.baseUrl, POSTPROXY_API_KEY: API_KEY, ZIGGY_REPORT_HOOK: "",
  ZIGGY_HYPERFRAMES_BIN: join(bins, "hyperframes"), ZIGGY_FFPROBE_BIN: join(bins, "ffprobe"), ZIGGY_FFMPEG_BIN: join(bins, "ffmpeg"), ...extra,
});
const creates = () => pp.calls.filter((c) => c.method === "POST" && c.path === "/api/posts");
const hookEnv = (file) => ({ ZIGGY_REPORT_HOOK: `printf '%s|%s' "$ZIGGY_REPORT_TENANT" "$ZIGGY_REPORT_TEXT" > ${file}` });
const renders = () => (existsSync(join(bins, "calls.log")) ? readFileSync(join(bins, "calls.log"), "utf8").trim().split("\n").filter((c) => c === "render").length : 0);

test("--publish: the week's reel goes out live now on Instagram and Facebook, logged like any post; --notify sends the summary", async () => {
  pubTenant("evpub");
  const hookFile = join(world.root, "evpub-hook.txt");
  const before = creates().length;
  const r = await runCli(["events", "evpub", "--week", "--publish", "--notify", "--now", MON, "--json"], PUB_ENV(hookEnv(hookFile)));
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.campaign, "eventi-2026-10-26");
  assert.deepEqual(d.publish.items.map((i) => [i.kind, i.status]), [["instagram_reel", "published"], ["facebook_reel", "published"]]);
  const made = creates().slice(before);
  assert.equal(made.length, 2, "one post per platform");
  assert.deepEqual(made.map((c) => c.fields["profiles[]"]), [["prof_ig"], ["prof_fb"]]);
  for (const c of made) {
    assert.notEqual(c.fields["post[draft]"], "true", "live, not a draft");
    assert.equal(c.fields["post[scheduled_at]"], undefined, "now, not scheduled");
  }
  const [ig, fb] = d.publish.items.map((i) => i.postId);
  assert.equal(d.text, `🗓️ Ragusa Buzz · Eventi della settimana 26 ott – 1 nov: reel pubblicato su Instagram (id ${ig}), Facebook (id ${fb})`);
  assert.equal(readFileSync(hookFile, "utf8"), `evpub|${d.text}`);
  assert.equal(d.notified, true);
  // posts.jsonl: live rows of the campaign, with the time they went out (what a round's Facebook guard counts)
  const rows = readPostLog("evpub").filter((x) => x.campaign === "eventi-2026-10-26");
  assert.deepEqual(rows.map((x) => [x.kind, x.platform, x.postId, x.live, x.scheduledAt]), [
    ["instagram_reel", "instagram", ig, true, "2026-10-26T06:00:00.000Z"],
    ["facebook_reel", "facebook", fb, true, "2026-10-26T06:00:00.000Z"],
  ]);
});

test("--publish re-run: already published platforms are never posted again, the reel is not re-rendered", async () => {
  const before = creates().length, rendered = renders();
  const r = await runCli(["events", "evpub", "--week", "--publish", "--now", "2026-10-26T09:00:00Z"], PUB_ENV());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(creates().length, before, "nothing posted");
  assert.equal(renders(), rendered, "the existing render is reused");
  assert.match(r.stdout, /campaign eventi-2026-10-26 already exists: reused/);
  assert.match(r.stdout, /instagram_reel +already published \(post_\d+\)/);
  assert.match(r.stdout, /facebook_reel +already published \(post_\d+\)/);
  assert.match(r.stdout, /reel pubblicato su Instagram \(già pubblicato, id post_\d+\), Facebook \(già pubblicato, id post_\d+\)/);
  // --force rebuilds the campaign and the render, still without a second post
  const forced = await runCli(["events", "evpub", "--week", "--publish", "--force", "--now", "2026-10-26T09:00:00Z"], PUB_ENV());
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(creates().length, before);
  assert.ok(renders() > rendered);
});

test("--publish after a Meta 368: Instagram goes out, Facebook is held with the pause; a later re-run publishes only Facebook", async () => {
  pubTenant("evhold");
  // a Facebook post that hit the 368 two hours earlier
  logPost("evhold", { campaign: "story-x", kind: "facebook_reel", postId: "bad_fb", profileId: "prof_fb", platform: "facebook", status: "scheduled", live: true, scheduledAt: "2026-10-26T04:00:00.000Z" });
  pp.state.posts.bad_fb = { id: "bad_fb", status: "processed", platforms: [BLOCK] };
  const hookFile = join(world.root, "evhold-hook.txt");
  const before = creates().length;
  const r = await runCli(["events", "evhold", "--week", "--publish", "--notify", "--now", MON, "--json"], PUB_ENV(hookEnv(hookFile)));
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.deepEqual(d.publish.items.map((i) => [i.kind, i.status, i.reason || null]), [["instagram_reel", "published", null], ["facebook_reel", "held", "pause"]]);
  assert.equal(d.publish.facebook.pausedUntil, "2026-10-28T04:00:00.000Z");
  assert.deepEqual(creates().slice(before).map((c) => c.fields["profiles[]"]), [["prof_ig"]], "Instagram only");
  assert.match(readFileSync(hookFile, "utf8"), /^evhold\|🗓️ Ragusa Buzz · Eventi della settimana 26 ott – 1 nov: reel pubblicato su Instagram \(id post_\d+\), Facebook \(in attesa: blocco anti-spam di Meta \(errore 368\), Facebook in pausa fino alle 28\/10 05:00\)$/);
  assert.equal(readPostLog("evhold").filter((x) => x.campaign === "eventi-2026-10-26").length, 1);

  // after the pause, the same command adds the Facebook post and leaves Instagram alone
  const later = await runCli(["events", "evhold", "--week", "--publish", "--now", "2026-10-28T10:00:00Z", "--json"], PUB_ENV());
  assert.equal(later.status, 0, later.stderr);
  assert.deepEqual(JSON.parse(later.stdout).publish.items.map((i) => [i.kind, i.status]), [["instagram_reel", "already"], ["facebook_reel", "published"]]);
  assert.deepEqual(creates().slice(before).map((c) => c.fields["profiles[]"]), [["prof_ig"], ["prof_fb"]]);
});

test("--publish: fewer than minEvents → no render, no post, exit 3, the skip line through the hook", async () => {
  pubTenant("evfew");
  api.set = "few";
  try {
    const hookFile = join(world.root, "evfew-hook.txt");
    const before = creates().length, rendered = renders();
    const r = await runCli(["events", "evfew", "--week", "--publish", "--notify", "--now", MON], PUB_ENV(hookEnv(hookFile)));
    assert.equal(r.status, 3, r.stderr);
    assert.equal(creates().length, before);
    assert.equal(renders(), rendered);
    assert.equal(existsSync(join(world.repo, "tenants", "evfew", "campaigns", "eventi-2026-10-26")), false);
    assert.match(readFileSync(hookFile, "utf8"), /^evfew\|⏭️ Ragusa Buzz · solo 2 eventi validi per 26 ott – 1 nov/);
  } finally {
    api.set = "all";
  }
});

test("--publish --dry-run: what would go out, nothing written, rendered or posted", async () => {
  pubTenant("evdry");
  const before = creates().length, rendered = renders();
  const r = await runCli(["events", "evdry", "--week", "--publish", "--dry-run", "--notify", "--now", MON], PUB_ENV({ ZIGGY_REPORT_HOOK: "exit 9" }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /instagram_reel +would publish live now/);
  assert.match(r.stdout, /facebook_reel +would publish live now/);
  assert.match(r.stdout, /🗓️ Ragusa Buzz · Eventi della settimana 26 ott – 1 nov \(prova, niente pubblicato\): reel da pubblicare su Instagram, Facebook/);
  assert.match(r.stdout, /nothing written, nothing published/);
  assert.equal(creates().length, before);
  assert.equal(renders(), rendered);
  assert.equal(existsSync(join(world.repo, "tenants", "evdry", "campaigns", "eventi-2026-10-26")), false);
  assert.deepEqual(readPostLog("evdry"), []);
});

test("--publish: a reel that fails the check (no audio) is not published; exit 1 and the owner hears of it", async () => {
  pubTenant("evmute");
  const hookFile = join(world.root, "evmute-hook.txt");
  const before = creates().length;
  const r = await runCli(["events", "evmute", "--week", "--publish", "--notify", "--now", MON], PUB_ENV({ FAKE_AUDIO: "none", ...hookEnv(hookFile) }));
  assert.equal(r.status, 1);
  assert.equal(creates().length, before);
  assert.match(readFileSync(hookFile, "utf8"), /reel non pubblicato: Instagram \(errore: reel no audio\), Facebook \(errore: reel no audio\)$/);
});

test("--publish goes with --week only", async () => {
  const r = await runCli(["events", "evpub", "--teaser", "--publish"], PUB_ENV());
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--publish goes with --week only/);
});

test("planWeekPublish: the Facebook guard counts posts that went out at once, the daily cap, the off switch", async () => {
  const client = createClient({ baseUrl: pp.baseUrl, apiKey: API_KEY });
  const campaign = { name: "eventi-2026-10-26", posts: { instagram_reel: { body: "x", media: "reel" }, facebook_reel: { body: "x", media: "reel" } } };
  const tenant = (slug, facebook) => ({ slug, name: "Ragusa Buzz", postproxy: { profileIds: ["prof_ig", "prof_fb"] }, daily: { tz: "Europe/Rome", only: ["instagram_reel", "facebook_reel", "tiktok"], facebook } });
  const fb = (slug, postId, at) => logPost(slug, { campaign: `story-${postId}`, kind: "facebook_reel", postId, platform: "facebook", status: "processed", live: true, scheduledAt: null, at });
  const status = (p) => p.items.map((i) => [i.kind, i.status, i.reason || null]);

  // a Facebook reel posted by hand an hour ago (no scheduledAt): too close
  fb("evgap", "fb_hand", "2026-10-26T05:00:00.000Z");
  const gap = await planWeekPublish(tenant("evgap", { minGapMinutes: 240 }), campaign, { client, now: new Date(MON) });
  assert.deepEqual(status(gap), [["instagram_reel", "publish", null], ["facebook_reel", "held", "gap"]], "tiktok is not in the campaign");
  // three already today in Rome (07:00, 11:30, 16:00): a fourth at 21:00 is over the cap
  for (const [id, at] of [["c1", "2026-10-26T06:00:00Z"], ["c2", "2026-10-26T10:30:00Z"], ["c3", "2026-10-26T15:00:00Z"]]) fb("evcap", id, at);
  const cap = await planWeekPublish(tenant("evcap", { maxPerDay: 3, minGapMinutes: 240 }), campaign, { client, now: new Date("2026-10-26T20:00:00Z") });
  assert.deepEqual(status(cap), [["instagram_reel", "publish", null], ["facebook_reel", "held", "cap"]]);
  const off = await planWeekPublish(tenant("evoff", { enabled: false }), campaign, { client, now: new Date(MON) });
  assert.deepEqual(status(off), [["instagram_reel", "publish", null], ["facebook_reel", "held", "disabled"]]);
  assert.match(weekPublishText({ name: "Ragusa Buzz", daily: { tz: "Europe/Rome" } }, "26 ott – 1 nov", { ...gap, dryRun: true }), /Facebook \(in attesa: un altro post Facebook a meno di 4 ore\)$/);
  assert.match(weekPublishText({ name: "Ragusa Buzz", daily: { tz: "Europe/Rome" } }, "26 ott – 1 nov", { ...cap, dryRun: false }), /Facebook \(in attesa: già 3 post Facebook oggi \(max 3 al giorno\)\)$/);
});

test("planWeekPublish: a disconnected profile is reported, the other platform still goes", async () => {
  const mock = await startMockPostproxy({ profiles: [
    { id: "prof_ig", name: "Ragusa Buzz", platform: "instagram", status: "active", profile_group_id: "grp_1" },
    { id: "prof_fb", name: "Ragusa Buzz Page", platform: "facebook", status: "disconnected", profile_group_id: "grp_1" },
  ] });
  try {
    const client = createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });
    const campaign = { name: "eventi-2026-10-26", posts: { instagram_reel: { body: "x", media: "reel" }, facebook_reel: { body: "x", media: "reel" } } };
    const t = { slug: "evdown", name: "Ragusa Buzz", postproxy: { profileIds: ["prof_ig", "prof_fb"] }, daily: { tz: "Europe/Rome", only: ["instagram_reel", "facebook_reel"] } };
    const p = await planWeekPublish(t, campaign, { client, now: new Date(MON) });
    assert.deepEqual(p.items.map((i) => [i.kind, i.status, i.reason || null]), [["instagram_reel", "publish", null], ["facebook_reel", "down", "disconnected"]]);
    assert.match(weekPublishText(t, "26 ott – 1 nov", { ...p, dryRun: false }), /Facebook \(non pubblicato: ricollega il profilo su Postproxy, stato disconnected\)$/);
  } finally { await mock.close(); }
});
