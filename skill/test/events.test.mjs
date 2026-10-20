import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  EVENTS_DEFAULTS, addDays, clampTitle, dateLabels, eventTemplateTokens, eventsConfig, eventsTimeline, fetchWeekEvents, listLabel, localDay,
  mergeEvents, normTitle, normalizeEvent, rangeLabel, resolveWeek, sameEvent, selectEvents, stripTownPrefix, teaserCampaign, untilLabel,
  venueOf, weekCampaign, weekdayOf, wordSpans,
} from "../scripts/events.mjs";
import { resolveVariants, scaffold } from "../scripts/video.mjs";
import { makeWorld, runCli } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;
const { loadTenant, fontsDir } = await import("../scripts/config.mjs");

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "events-2026-10-26.json"), "utf8")).data;
const CFG = eventsConfig({ slug: "ragusa", events: { exclusiveEndSources: ["ccn-antica-ibla-api"] } });
const WEEK = resolveWeek({ from: "2026-10-26" });

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

test("the week of 26 October 2026: exclusions, merges, labels, six cards in time order", () => {
  const r = selectEvents(FIXTURE, CFG, { week: WEEK });
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

test("town spread: a town already picked costs the next candidate there", () => {
  const list = [
    ...Array.from({ length: 7 }, (_, i) => ev({ title: `Concerto Ragusa ${i}`, category: "musica-live", startsLocal: `2026-10-${30 + (i % 2)}T21:0${i}` })),
    ev({ title: "Sagra a Scicli", category: "sagre", startsLocal: "2026-10-28T10:00", place: { name: "", town: "Scicli" } }),
  ];
  const spread = selectEvents(list, CFG, { week: WEEK }).chosen;
  assert.equal(spread.length, 6);
  assert.ok(spread.some((c) => c.town === "Scicli"));
  const flat = selectEvents(list, { ...CFG, weights: { ...CFG.weights, sameTown: 0 } }, { week: WEEK }).chosen;
  assert.ok(!flat.some((c) => c.town === "Scicli"), "without the spread the stronger Ragusa nights win");
});

test("max and min: at most maxEvents cards; fewer than minEvents is a skip", () => {
  const three = [ev({ title: "Uno" }), ev({ title: "Due", startsLocal: "2026-10-31T21:00" }), ev({ title: "Tre", startsLocal: "2026-11-01T18:00" })];
  assert.equal(selectEvents(three, { ...CFG, maxEvents: 2 }, { week: WEEK }).chosen.length, 2);
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
  const r = selectEvents(FIXTURE, CFG, { week: WEEK });
  const cards = r.chosen.map((c, i) => ({ ...c, posterFile: i === 1 ? null : `posters/${c.id}.webp` }));
  const c = weekCampaign({ name: "Ragusa Buzz", language: "it" }, CFG, WEEK, cards);
  assert.equal(c.template, "eventi-settimana");
  assert.equal(c.duration, 20);
  assert.deepEqual(c.timing, { intro: 3, card: 2.25, outro: 3.5 });
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
  assert.equal(eventsTimeline(10).duration, 20);
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
  const r = selectEvents(FIXTURE, CFG, { week: WEEK });
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
  assert.equal(d.chosen.length, 6);
  assert.ok(d.excluded.length > 0);
  assert.equal(existsSync(join(world.repo, "tenants", "evcli", "campaigns", "eventi-2026-10-26")), false);
  assert.ok(api.hits.some((h) => h.includes("from=2026-09-11&to=2026-10-25")));
});

test("cli: --no-render writes the campaign and downloads the posters; --force to redo", async () => {
  const r = await runCli(["events", "evcli", "--week", "--from", "2026-10-26", "--no-render"], world.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /campaign eventi-2026-10-26 →/);
  assert.match(r.stdout, /nothing was posted/);
  const dir = join(world.repo, "tenants", "evcli", "campaigns", "eventi-2026-10-26");
  const c = JSON.parse(readFileSync(join(dir, "campaign.json"), "utf8"));
  assert.equal(c.events.length, 6);
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
