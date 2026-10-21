import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { campaignFromStory, campaignNameFor, fetchStories, normalizeStory, pick, slugify, createStoryCampaign, buildSummaryPrompt, buildRewritePrompt, parseSummaryLines, summarizeStory, storyDetailUrl, storyPoints, htmlToText, fetchStoryBody } from "../scripts/story.mjs";
import { campaignRepetition, captionPoints, captionRepetition, pointsReport, storyCaption, stripPointLabels } from "../scripts/lint.mjs";
import { composeThread } from "../scripts/thread.mjs";
import { endCard, resolveVariants, scaffold, sourceCount } from "../scripts/video.mjs";
import { makeWorld } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;
const { loadTenant } = await import("../scripts/config.mjs");
// after ZIGGY_HOME: casefile.mjs keeps its template state there
const { campaignFromCasefile } = await import("../scripts/casefile.mjs");

const FEED = {
  url: "https://acme.example/feed/v1/briefings?lang=en&limit=5",
  items: "data",
  fields: { title: "title", dek: "dek", section: "sector.name", date: "storyDate", image: "imageUrl", slug: "slug", sources: "sourceCount", languages: "languageCount" },
  imageRewrite: { match: "^.*?/api/assets/tenants/[0-9a-f-]+/", replace: "https://acme.example/assets/" },
  storyUrl: "https://acme.example/#/b/{slug}?lang=en",
  displayUrl: "acme.example",
  agent: null,
};
const ITEM = {
  title: "Modelling Suggests Nearby Binary 70 Ophiuchi Could Host Earth-Sized Planet",
  dek: "A modelled orbit could sustain an Earth-sized world, but no planet has been detected.",
  storyDate: "2026-10-05T01:22:04Z",
  sector: { name: "Science & Health" },
  imageUrl: "http://localhost:34002/api/assets/tenants/0c0000cf-86bc-488e-9c70-6688f9a30427/images/a/b.jpg",
  slug: "modelling-study-suggests-nearby-binary-star-70-ophiuchi-11f587e9",
  sourceCount: 2,
  languageCount: 2,
};

test("dotted paths, slugify, image rewrite and story url", () => {
  assert.equal(pick({ a: { b: [{ c: 1 }] } }, "a.b.0.c"), 1);
  assert.equal(slugify("Héllo, World! — 70 Ophiuchi"), "hello-world-70-ophiuchi");
  const st = normalizeStory(ITEM, FEED);
  assert.equal(st.image, "https://acme.example/assets/images/a/b.jpg");
  assert.equal(st.section, "Science & Health");
  assert.match(st.url, /^https:\/\/acme\.example\/#\/b\/modelling-study/);
});

test("fetchStories handles pagination with nextCursor", async () => {
  const tenant = { slug: "acme", feed: FEED };
  let callCount = 0;
  const mockFetch = async (url) => {
    callCount++;
    const hasNext = !url.includes("cursor=");
    return {
      ok: true,
      json: async () => ({
        data: [
          { ...ITEM, slug: `story-${callCount}-abc123`, title: `Story ${callCount}` }
        ],
        page: hasNext ? { nextCursor: "cursor123" } : {}
      })
    };
  };
  const stories = await fetchStories(tenant, { fetchImpl: mockFetch });
  assert.equal(callCount, 2, "Should fetch two pages");
  assert.equal(stories.length, 2, "Should return stories from both pages");
  assert.equal(stories[0].title, "Story 1");
  assert.equal(stories[1].title, "Story 2");
});

test("fetchStories respects maxItems limit", async () => {
  const tenant = { slug: "acme", feed: FEED };
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({
        data: Array.from({ length: 50 }, (_, i) => ({ ...ITEM, slug: `story-${i}`, title: `Story ${i}` })),
        page: { nextCursor: "cursor123" }
      })
    };
  };
  const stories = await fetchStories(tenant, { fetchImpl: mockFetch, maxItems: 100 });
  assert.ok(callCount >= 2, "Should fetch multiple pages");
  assert.equal(stories.length, 100, "Should limit to maxItems");
});

test("fetchStories stops when no nextCursor", async () => {
  const tenant = { slug: "acme", feed: FEED };
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({
        data: [{ ...ITEM, slug: "story-1", title: "Story 1" }],
        page: {} // No nextCursor
      })
    };
  };
  const stories = await fetchStories(tenant, { fetchImpl: mockFetch });
  assert.equal(callCount, 1, "Should fetch only one page when no cursor");
  assert.equal(stories.length, 1);
});

test("campaignFromStory builds a story-template campaign with reel post and English copy", () => {
  const tenant = { slug: "acme", name: "Acme", site: "https://acme.example/", language: "en", feed: FEED };
  const c = campaignFromStory(tenant, normalizeStory(ITEM, FEED));
  assert.equal(c.template, "story");
  assert.equal(c.copy.kicker, "Science & Health · 5 Oct 2026");
  assert.equal(c.copy.meta, "2 sources · 2 languages");
  assert.equal(c.copy.url, "acme.example");
  assert.equal(c.posts.instagram_reel.media, "reel");
  assert.equal(c.posts.instagram_reel.cover, true);
  assert.ok(c.posts.instagram_reel.body.includes(`Full story with sources: ${c.story.url}`));
  assert.equal(c.posts.instagram_reel.first_comment, undefined, "no comment-LINK flow: the caption carries the link");
  assert.equal(c.posts.twitter.media, "reel");
  assert.equal(c.posts.twitter.alt_text, c.copy.headline);
  assert.equal(c.posts.twitter.enabled, false);
  assert.equal(c.posts.twitter.body, c.copy.headline);
  assert.equal(c.posts.twitter.body.includes("http"), false);
  assert.equal(c.posts.twitter.thread.at(-1).body, c.story.url);
  assert.equal(c.posts.twitter.thread[0].body, c.copy.dek);
  assert.deepEqual(c.posts.instagram_post.media, ["slide-cover", "slide-dek", "slide-close"]);
  assert.equal(c.posts.instagram_post.enabled, false);
  assert.equal(c.posts.tiktok.media, "reel");
  assert.equal(c.posts.tiktok.body, c.posts.instagram_reel.body);
  assert.equal(c.posts.tiktok.enabled, false);
  assert.equal(c.posts.tiktok.platform.privacy_status, "PUBLIC_TO_EVERYONE");
  assert.equal(c.posts.tiktok.platform.disable_comment, false);
  // no summary: the reel is title and close, never the dek split into slides
  assert.deepEqual(c.copy.points, []);
  assert.deepEqual(c.copy.droppedPoints, []);
  assert.equal(c.duration, 13);
});

test("campaignFromStory honours the tenant's social copy and Italian sources line", () => {
  const tenant = {
    slug: "acme", name: "Acme", site: "https://acme.example/", language: "it", feed: FEED,
    social: { cta: "La storia completa: {url}", hashtags: "#Ragusa #Sicilia" },
  };
  const c = campaignFromStory(tenant, normalizeStory(ITEM, FEED));
  assert.match(c.posts.instagram_reel.body, /Basato su 2 fonti in 2 lingue\./);
  assert.match(c.posts.instagram_reel.body, /La storia completa: https:\/\/acme\.example\/#\/b\/modelling/);
  assert.match(c.posts.instagram_reel.body, /#Ragusa #Sicilia$/);
  assert.ok(!c.posts.instagram_reel.body.includes("#UFO"));
  assert.equal(c.posts.instagram_reel.first_comment, undefined);
});

// a real Ragusa story: the AI points retell the title and the dek
const SCICLI = {
  title: "Merci ferme e serre piene a Scicli: lo sciopero dei tir pesa sul florovivaismo",
  dek: "La FlorGuarino denuncia 100mila euro di orchidee e rose olandesi in parte non arrivate, 20mila euro di ordini già cancellati e 12mila piante di basilico rimaste in serra.",
  points: [
    "Lo sciopero dei tir pesa sul florovivaismo di Scicli.",
    "La FlorGuarino segnala 100mila euro di orchidee e rose olandesi in parte non arrivate.",
    "Sono già stati cancellati ordini per 20mila euro.",
    "12mila piante di basilico sono rimaste in serra.",
  ],
  url: "https://ragusa.buzz/#/b/la-protesta-degli-autotrasportatori-paralizza-la-florguarino-ordini-pers-90e6f218-9ed6dbea?lang=it",
};
const RAGUSA = {
  slug: "ragusa", name: "Ragusa Buzz", site: "https://ragusa.buzz/", language: "it", feed: { displayUrl: "ragusa.buzz" },
  social: { cta: "La storia completa: {url}", hashtags: "#Ragusa #Sicilia #Cronaca #Notizie" },
};
const scicliStory = () => ({ title: SCICLI.title, dek: SCICLI.dek, slug: "la-protesta-degli-autotrasportatori-90e6f218", url: SCICLI.url, date: "2026-10-19T08:00:00Z", section: "Cronaca", sources: 2, languages: 1 });

test("story caption: points that only retell headline and dek are on neither the reel nor the caption", () => {
  const c = campaignFromStory(RAGUSA, scicliStory(), { points: SCICLI.points });
  const body = c.posts.instagram_reel.body;
  assert.equal(body, `${SCICLI.title}\n\n${SCICLI.dek}\n\nBasato su 2 fonti in 1 lingua.\n\nLa storia completa: ${SCICLI.url}\n\n#Ragusa #Sicilia #Cronaca #Notizie`);
  for (const p of SCICLI.points) assert.ok(!body.includes(p), `no points paragraph: ${p}`);
  assert.doesNotMatch(body, /•/);
  assert.deepEqual(c.copy.points, [], "the slides would retell them too");
  assert.deepEqual(c.copy.captionPoints, []);
  assert.deepEqual(c.copy.droppedPoints, SCICLI.points.map((point, i) => ({ point, reason: ["no new words", "dek", "no new words", "no new words"][i] })));
  assert.equal(c.duration, 13, "title and close only");
  for (const k of ["tiktok", "facebook_reel", "instagram_post"]) assert.equal(c.posts[k].body, body, k);
  // the sources line is its own paragraph, never glued to the sentence before
  const en = campaignFromStory({ slug: "acme", name: "Acme", site: "https://acme.example/", language: "en", feed: FEED }, normalizeStory(ITEM, FEED));
  assert.ok(en.posts.instagram_reel.body.split("\n\n").includes("Sourced from 2 reports in 2 languages."), en.posts.instagram_reel.body);
  assert.doesNotMatch(en.posts.instagram_reel.body, / Sourced from/);
  // without a source count there is no sources paragraph at all
  const none = campaignFromStory(RAGUSA, { ...scicliStory(), sources: null }).posts.instagram_reel.body;
  assert.equal(none, `${SCICLI.title}\n\n${SCICLI.dek}\n\nLa storia completa: ${SCICLI.url}\n\n#Ragusa #Sicilia #Cronaca #Notizie`);
  // and no sentence in it is a near-copy of the title or of another sentence
  assert.deepEqual(captionRepetition(body, { title: SCICLI.title }), { ok: true, pairs: [] });
});

test("caption lint: the old caption with paraphrased points is flagged, the new one passes", () => {
  const old = [SCICLI.title, SCICLI.dek, ...SCICLI.points.slice(0, 3), `${SCICLI.points[3]} Basato su 2 fonti in 1 lingua.`, `La storia completa: ${SCICLI.url}`, "#Ragusa #Sicilia #Cronaca #Notizie"].join("\n\n");
  const r = captionRepetition(old, { title: SCICLI.title });
  assert.equal(r.ok, false);
  assert.ok(r.pairs.some((p) => p.a === SCICLI.title && p.b === SCICLI.points[0] && p.score === 1), "point 1 retells the title");
  for (const p of SCICLI.points.slice(1)) assert.ok(r.pairs.some((x) => x.a === SCICLI.dek && x.b === p && x.score >= 0.6), `dek ~ ${p}`);
  assert.ok(r.pairs.every((p, i) => i === 0 || r.pairs[i - 1].score >= p.score), "worst pair first");
  // links, hashtags and the sources line are not sentences of the story
  assert.ok(r.pairs.every((p) => !/https?:|#Ragusa|Basato su/.test(p.a + p.b)), JSON.stringify(r.pairs));
  // a dek may echo its headline (names, places) without being a copy: 0.8 against the headline
  const title = "A Briefcase in New Jersey and a Researcher's Call for Plasma Orb Testimony";
  const dek = "Two separate bids to gather UFO testimony: a confidential briefcase handoff to MUFON in New Jersey, and an appeal by researcher Robert Hastings for accounts of plasma orbs.";
  assert.equal(captionRepetition(`${title}\n\n${dek}`, { title }).ok, true);
  assert.equal(captionRepetition(`${title}\n\n${dek}`, { title, titleThreshold: 0.6 }).ok, false);
  // sentences under 4 content words are not compared
  assert.equal(captionRepetition("Storm hits the coast\n\nStorm hits.\n\nStorm hits.", { title: "Storm hits the coast" }).ok, true);
});

test("a dek that restates its headline is refused; one that adds facts goes out", () => {
  const ferry = { title: "Ferry service to the island resumes after the storm", slug: "ferry-resumes-1a2b3c4d", url: "https://acme.example/#/b/ferry-resumes-1a2b3c4d", date: "2026-10-19T08:00:00Z", section: "News", sources: 2, languages: 1 };
  const tenant = { slug: "acme", name: "Acme", site: "https://acme.example/", language: "en", feed: FEED };
  // the dek reorders the headline and changes a verb form: still the headline, told twice
  const echo = campaignFromStory(tenant, { ...ferry, dek: "After the storm, ferry service to the island has resumed. Tickets go on sale today." });
  const r = campaignRepetition(echo);
  assert.equal(r.ok, false);
  assert.equal(r.kind, "instagram_reel");
  assert.deepEqual(r.pairs.map((p) => [p.a, p.b, p.score]), [[ferry.title, "After the storm, ferry service to the island has resumed.", 0.8]]);
  assert.equal(r.reason, 'caption repeats itself: "Ferry service to the island resumes after the storm" ~ "After the storm, ferry service to the island has resumed."');
  // Italian: the dek folds the headline's words into a longer sentence
  const scicli = campaignFromStory(RAGUSA, { ...scicliStory(), title: "Scicli, lo sciopero dei tir pesa sul florovivaismo", dek: "A Scicli il florovivaismo paga lo sciopero dei tir: pesa sulle serre della FlorGuarino." });
  assert.equal(campaignRepetition(scicli).pairs[0].score, 1);
  // a dek that adds facts not in the headline passes
  const fresh = campaignFromStory(tenant, { ...ferry, dek: "The first crossing leaves Marina at 7:00 on Monday; the port authority expects delays all week." });
  assert.deepEqual(campaignRepetition(fresh), { ok: true, pairs: [] });
  assert.equal(campaignRepetition(campaignFromStory(RAGUSA, scicliStory(), { points: SCICLI.points })).ok, true);
});

test("case file points never carry their label twice", () => {
  assert.equal(stripPointLabels("Confirmed: Confirmed: The records exist."), "The records exist.");
  assert.equal(stripPointLabels("✅ Confirmed: ✅ CONFIRMED: The records exist."), "The records exist.");
  assert.equal(stripPointLabels("❓ Not confirmed: not confirmed: Congress was denied them."), "Congress was denied them.");
  assert.equal(stripPointLabels("Confermato: Confermato: il fatto."), "il fatto.");
  assert.equal(stripPointLabels("VERIFIED: VERIFIED: radar data.", ["VERIFIED", "DISPUTED", "IMPLICATIONS"]), "radar data.");
  assert.equal(stripPointLabels("Confirmed sightings rose in 2026."), "Confirmed sightings rose in 2026.", "a word, not a label");
  const c = campaignFromCasefile({ slug: "acme-casefile", name: "Acme", site: "https://acme.example/", language: "en", feed: { displayUrl: "acme.example" } }, {
    headline: "AARO found the records. It released none.",
    dek: "A FOIA reply tied to five cases was withheld in full as classified.",
    points: ["Confirmed: Confirmed: AARO located the records.", "❓ Not confirmed: Not confirmed: Congress was denied them.", "Why it matters: Why it matters: the reports stay secret."],
    source: { outlet: "The Black Vault", url: "https://example.com/foia" },
    template: "casefile-dossier",
  });
  assert.deepEqual(c.copy.points, ["AARO located the records.", "Congress was denied them.", "the reports stay secret."]);
  const body = c.posts.instagram_reel.body;
  assert.match(body, /✅ CONFIRMED: AARO located the records\./);
  assert.match(body, /❓ NOT CONFIRMED: Congress was denied them\./);
  assert.match(body, /WHY IT MATTERS: the reports stay secret\./);
  assert.doesNotMatch(body, /(confirmed|why it matters):\s*(✅\s*|❓\s*)?(not )?(confirmed|why it matters):/i);
});

// points written from the article: each adds a fact the Scicli title and dek do not have
const NEW_FACTS = [
  "Il presidio dei camionisti resta al porto di Pozzallo fino a venerdì.",
  "La Coldiretti chiede un tavolo in Prefettura entro lunedì 26 ottobre.",
  "L'azienda ha messo in cassa integrazione 14 dipendenti.",
  "La FlorGuarino stima altre perdite se il blocco supera la settimana.",
];

test("captionPoints: only the points that add a fact, in order, list markers off, at most 3", () => {
  const opts = { title: SCICLI.title, dek: SCICLI.dek };
  const lintOk = (kept, o = opts) => assert.deepEqual(captionRepetition(storyCaption({ ...o, points: kept }), { title: o.title }), { ok: true, pairs: [] });
  // the real Ragusa points retell title and dek: none is left for the caption
  assert.deepEqual(captionPoints(SCICLI.points, opts), []);
  assert.deepEqual(pointsReport(SCICLI.points, opts).dropped.map((d) => d.reason), ["no new words", "dek", "no new words", "no new words"]);
  // new facts stay, in order; the fourth is over the limit
  assert.deepEqual(captionPoints(NEW_FACTS, opts), NEW_FACTS.slice(0, 3));
  assert.deepEqual(pointsReport(NEW_FACTS, opts).dropped, [{ point: NEW_FACTS[3], reason: "max" }]);
  assert.deepEqual(captionPoints(NEW_FACTS, { ...opts, max: 1 }), [NEW_FACTS[0]]);
  lintOk(captionPoints(NEW_FACTS, opts));
  // a point that retells the headline with one word more
  const retitle = "Lo sciopero dei tir pesa molto sul florovivaismo di Scicli.";
  assert.deepEqual(pointsReport([retitle, NEW_FACTS[0]], opts), { kept: [NEW_FACTS[0]], dropped: [{ point: retitle, reason: "title" }] });
  // two points that say the same thing: the second goes
  const again = "Fino a venerdì i camionisti restano in presidio al porto di Pozzallo.";
  assert.deepEqual(pointsReport([NEW_FACTS[0], again, NEW_FACTS[1]], opts), { kept: [NEW_FACTS[0], NEW_FACTS[1]], dropped: [{ point: again, reason: "point" }] });
  // the mix: retold ones out, new ones in
  const mixed = [SCICLI.points[0], NEW_FACTS[0], SCICLI.points[1], again, NEW_FACTS[1], SCICLI.points[3], NEW_FACTS[2]];
  assert.deepEqual(captionPoints(mixed, opts), NEW_FACTS.slice(0, 3));
  lintOk(captionPoints(mixed, opts));
  // list markers off, never a number's "3."
  assert.deepEqual(captionPoints([`• ${NEW_FACTS[0]}`, `2) ${NEW_FACTS[1]}`, `- ${NEW_FACTS[2]}`], opts), NEW_FACTS.slice(0, 3));
  assert.deepEqual(captionPoints(["3.000 euro di danni alle serre di Vittoria."], opts), ["3.000 euro di danni alle serre di Vittoria."]);
  // a short point is not compared by overlap, but one with nothing new goes, and a new number is new
  const ferry = { title: "Ferry service to the island resumes after the storm", dek: "The first crossing leaves Marina on Monday; the port authority expects delays all week." };
  assert.deepEqual(pointsReport(["The ferry leaves Marina.", "The ferry leaves at 7."], ferry), { kept: ["The ferry leaves at 7."], dropped: [{ point: "The ferry leaves Marina.", reason: "no new words" }] });
  // the same short point twice: once
  assert.deepEqual(captionPoints(["Sono 2 feriti.", "Sono 2 feriti.", "Sono 3 feriti."], { title: "Incidente sulla statale", dek: "Due auto si sono scontrate all'alba." }), ["Sono 2 feriti.", "Sono 3 feriti."]);
  // the caption's tail counts: a point that echoes the CTA would fail the lint
  const harbour = { title: "Harbour reopens after the storm", dek: "The port authority lifted the ban this morning." };
  const tail = "Read the full story of the harbour reopening on acme.example.";
  const echo = "Read about the harbour reopening story in full tomorrow.";
  assert.deepEqual(pointsReport([echo], { ...harbour, tail }).dropped, [{ point: echo, reason: "lint" }]);
  assert.deepEqual(captionPoints([echo], harbour), [echo]);
  // nothing to work with: nothing to show
  assert.deepEqual(captionPoints(undefined), []);
  assert.deepEqual(captionPoints([]), []);
  assert.deepEqual(captionPoints("not a list", opts), []);
  assert.deepEqual(captionPoints(["", "  ", null, "•"], opts), []);
});

test("storyDetailUrl: the list path + slug with only its lang, or feed.detailUrl", () => {
  assert.equal(storyDetailUrl({ feed: { url: "https://ragusa.buzz/feed/v1/briefings?lang=it&limit=50" } }, "scicli-90e6f218"), "https://ragusa.buzz/feed/v1/briefings/scicli-90e6f218?lang=it");
  assert.equal(storyDetailUrl({ feed: { url: "https://alienwatch.buzz/feed/v1/briefings?limit=50&lang=en" } }, "orb-11f587e9"), "https://alienwatch.buzz/feed/v1/briefings/orb-11f587e9?lang=en");
  assert.equal(storyDetailUrl({ feed: { url: "http://127.0.0.1:9/feed/?limit=20" } }, "a b/c"), "http://127.0.0.1:9/feed/a%20b%2Fc");
  assert.equal(storyDetailUrl({ feed: { url: "https://x.example/list?lang=it", detailUrl: "https://x.example/api/story/{slug}.json" } }, "s-1"), "https://x.example/api/story/s-1.json");
  assert.equal(storyDetailUrl({ feed: {} }, "s"), null);
  assert.equal(storyDetailUrl({ feed: { url: "https://x.example/list" } }, ""), null);
  assert.equal(storyDetailUrl({}, "s"), null);
});

test("htmlToText: tags off, entities decoded once, a blank line between paragraphs", () => {
  const html = `<h2>Il porto</h2>\n  <p>Riapre alle <strong>7:00</strong>,\n   dice la   Capitaneria.</p>
    <p>Fonti: Comune &amp; Regione, &quot;ok&quot; &#39;sì&#39; &lt;b&gt; &#8211; &#x2014;&nbsp;fine &amp;lt;</p><script>alert(1)</script><style>p {}</style><!-- note --><ul><li>Uno</li><li>Due</li></ul>`;
  assert.equal(htmlToText(html), "Il porto\n\nRiapre alle 7:00, dice la Capitaneria.\n\nFonti: Comune & Regione, \"ok\" 'sì' <b> – — fine &lt;\n\nUno\n\nDue");
  assert.equal(htmlToText(""), "");
  assert.equal(htmlToText(undefined), "");
  assert.equal(htmlToText("plain text"), "plain text");
});

test("fetchStoryBody: the detail endpoint's article as plain text, cut at a sentence end; '' on any failure", async () => {
  const tenant = { slug: "ragusa", language: "it", feed: { url: "https://ragusa.buzz/feed/v1/briefings?lang=it&limit=50" } };
  const story = { slug: "scicli-90e6f218" };
  const seen = [];
  const reply = (payload, status = 200) => async (url, opts) => {
    seen.push({ url: String(url), signal: opts?.signal });
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status });
  };
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: reply({ data: { title: "x", bodyHtml: "<p>Uno.</p><p>Due &amp; tre.</p>", sources: [] } }) }), "Uno.\n\nDue & tre.");
  assert.equal(seen[0].url, "https://ragusa.buzz/feed/v1/briefings/scicli-90e6f218?lang=it");
  assert.ok(seen[0].signal instanceof AbortSignal, "the request carries a timeout");
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: reply({ bodyHtml: "<p>Top level.</p>" }) }), "Top level.");
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: reply({ body: "<p>Plain body.</p>" }) }), "Plain body.");
  // cut after the last sentence that fits
  const long = `<p>${"Prima frase del pezzo. ".repeat(10)}</p>`;
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: reply({ data: { bodyHtml: long } }), maxChars: 50 }), "Prima frase del pezzo. Prima frase del pezzo.");
  assert.ok((await fetchStoryBody(tenant, story, { fetchImpl: reply({ data: { bodyHtml: long } }) })).length <= 2500);
  // never a throw: a round must not fail on the article
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: reply("not found", 404) }), "");
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: reply("{ not json") }), "");
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: reply({ data: [] }) }), "");
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: async () => { throw new TypeError("fetch failed"); }, retryDelayMs: 0 }), "");
  // a request that never answers (the timer stands in for the open socket: AbortSignal.timeout's own is unref'd)
  const hang = (url, { signal }) => new Promise((_, reject) => {
    const socket = setTimeout(() => {}, 5_000);
    signal.addEventListener("abort", () => { clearTimeout(socket); reject(signal.reason); });
  });
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: hang, timeoutMs: 20 }), "");
  let called = false;
  assert.equal(await fetchStoryBody({ slug: "x", feed: {} }, story, { fetchImpl: async () => { called = true; } }), "");
  assert.equal(called, false, "no URL, no request");
});

test("fetchStoryBody: a request that fails outright is tried once more; an HTTP error or a timeout is not", async () => {
  const tenant = { slug: "ragusa", language: "it", feed: { url: "https://ragusa.buzz/feed/v1/briefings?lang=it&limit=50" } };
  const story = { slug: "scicli-90e6f218" };
  const article = () => new Response(JSON.stringify({ data: { bodyHtml: "<p>Di nuovo su.</p>" } }), { status: 200 });
  // the stale keep-alive socket: the first call fails, the next one gets through
  let signals = [];
  const flaky = async (url, { signal }) => { signals.push(signal); if (signals.length === 1) throw new TypeError("fetch failed"); return article(); };
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: flaky, retryDelayMs: 0 }), "Di nuovo su.");
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1], "each try has its own timeout");
  // down twice: one retry, not more, and still no throw
  let calls = 0;
  const down = async () => { calls++; throw new TypeError("fetch failed"); };
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: down, retryDelayMs: 0 }), "");
  assert.equal(calls, 2);
  // the retry waits retryDelayMs
  signals = [];
  const t0 = Date.now();
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: flaky, retryDelayMs: 40 }), "Di nuovo su.");
  assert.ok(Date.now() - t0 >= 35, `${Date.now() - t0} ms`);
  // an HTTP error is an answer, not a dropped socket
  calls = 0;
  const bad = async () => { calls++; return new Response("bad gateway", { status: 502 }); };
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: bad, retryDelayMs: 0 }), "");
  assert.equal(calls, 1);
  // a timeout already waited timeoutMs: no second wait
  calls = 0;
  const hang = (url, { signal }) => new Promise((_, reject) => {
    calls++;
    const socket = setTimeout(() => {}, 5_000);
    signal.addEventListener("abort", () => { clearTimeout(socket); reject(signal.reason); });
  });
  assert.equal(await fetchStoryBody(tenant, story, { fetchImpl: hang, timeoutMs: 20, retryDelayMs: 0 }), "");
  assert.equal(calls, 1);
});

test("the summary prompt: with the article, its facts that headline and deck do not say; without, the same as before", () => {
  const story = normalizeStory(ITEM, FEED);
  const en = { slug: "acme", language: "en", feed: FEED };
  const it = { slug: "acme", language: "it", feed: FEED };
  assert.equal(buildSummaryPrompt(en, story), [
    "Summarise this story as 3-4 slides for a vertical reel. Each slide adds a new fact (what happened, who, when/where, what it means): the first does not repeat the headline, none repeats another.",
    "Rules: short sentences (max 90 characters each), plain language, no emoji, no numbering, one sentence per slide.",
    "Print ONLY the slides, one per line, nothing else.",
    "",
    `Headline: ${story.title}`,
    `Deck: ${story.dek}`,
  ].join("\n"));
  assert.equal(buildSummaryPrompt(en, { ...story, body: "" }), buildSummaryPrompt(en, story), "an empty body is no body");
  const body = "The team at the University of Geneva ran 10,000 simulated orbits.\n\nA follow-up search with ESPRESSO starts in 2027.";
  const p = buildSummaryPrompt(en, { ...story, body });
  assert.match(p, /told with facts from the article/);
  assert.match(p, /Prefer facts NOT already in the headline or deck: numbers, names, dates, what happens next/);
  assert.match(p, /Slide 1 does not repeat the headline, none repeats another or the deck/);
  assert.match(p, /max 90 characters each/);
  assert.match(p, /one sentence per slide/);
  assert.match(p, /invent nothing/);
  assert.ok(p.endsWith(`Deck: ${story.dek}\nArticle: ${body}`), p);
  const pit = buildSummaryPrompt(it, { ...story, body });
  assert.match(pit, /con i fatti dell'articolo/);
  assert.match(pit, /numeri, nomi, date, cosa succede dopo/);
  assert.match(pit, /La prima slide non ripete il titolo/);
  assert.match(pit, /max 90 caratteri/);
  assert.match(pit, /non inventare nulla/);
  assert.ok(pit.indexOf("Deck:") < pit.indexOf("Article:"));
});

test("summarizeStory reads the article from the detail endpoint when the story does not carry it", async () => {
  const tenant = { slug: "acme", name: "Acme", site: "https://acme.example/", language: "en", feed: { ...FEED, agent: { command: ["fake-agent"] } } };
  const story = normalizeStory(ITEM, FEED);
  const slides = ["Geneva astronomers ran 10,000 simulated orbits.", "A stable zone sits 1.2 AU from the larger star.", "ESPRESSO starts a follow-up search in 2027."];
  const prompts = [], urls = [];
  const spawnImpl = (bin, args, { input }) => { prompts.push(input); return { status: 0, stdout: slides.join("\n"), stderr: "" }; };
  const fetchImpl = async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ data: { bodyHtml: "<p>Geneva ran 10,000 orbits.</p>" } }), { status: 200 }); };
  assert.deepEqual(await summarizeStory(tenant, story, { spawnImpl, fetchImpl }), slides);
  assert.deepEqual(urls, [`https://acme.example/feed/v1/briefings/${ITEM.slug}?lang=en`]);
  assert.match(prompts[0], /\nArticle: Geneva ran 10,000 orbits\.$/);
  // a story that already carries its body (a round's plan) is not fetched again
  await summarizeStory(tenant, { ...story, body: "Known body." }, { spawnImpl, fetchImpl });
  assert.equal(urls.length, 1);
  assert.match(prompts[1], /\nArticle: Known body\.$/);
  // the campaign: every slide on the reel, the new facts in the caption
  const c = campaignFromStory(tenant, story, { points: slides });
  assert.deepEqual(c.copy.points, slides);
  assert.deepEqual(c.copy.captionPoints, slides);
  assert.ok(c.posts.instagram_reel.body.includes(`${ITEM.dek}\n\n${slides.map((s) => `• ${s}`).join("\n")}\n\nSourced from 2 reports in 2 languages.`), c.posts.instagram_reel.body);
});

test("createStoryCampaign (the daily loop's path) hands its fetchImpl to the summary: the article reaches the agent", async () => {
  const tenant = { ...loadTenant("acme"), feed: { ...FEED, agent: { command: ["fake-agent"] } } };
  const slides = ["Geneva astronomers ran 10,000 simulated orbits.", "A stable zone sits 1.2 AU from the larger star.", "ESPRESSO starts a follow-up search in 2027."];
  let prompt = "";
  const spawnImpl = (bin, args, { input }) => { prompt = input; return { status: 0, stdout: slides.join("\n"), stderr: "" }; };
  const fetchImpl = async (url) => {
    assert.equal(String(url), `https://acme.example/feed/v1/briefings/${ITEM.slug}?lang=en`);
    return new Response(JSON.stringify({ data: { bodyHtml: "<p>Geneva ran 10,000 orbits.</p>" } }), { status: 200 });
  };
  const made = await createStoryCampaign(tenant, { story: normalizeStory(ITEM, FEED), fetchImpl, spawnImpl, write: false, force: true });
  assert.match(prompt, /\nArticle: Geneva ran 10,000 orbits\.$/);
  assert.deepEqual(made.campaign.copy.points, slides);
  assert.deepEqual(made.campaign.copy.captionPoints, slides);
  assert.deepEqual(campaignRepetition(made.campaign), { ok: true, pairs: [] });
});

test("summarizeStory: fewer than 2 points survive → one rewrite from the article, told what was rejected; the list that keeps more wins", async () => {
  const tenant = { ...loadTenant("acme"), language: "en", feed: { ...FEED, agent: { command: ["fake-agent"] } } };
  const story = normalizeStory(ITEM, FEED);
  const echo = ["Modelling suggests 70 Ophiuchi could host an Earth-sized planet.", "A modelled orbit could sustain an Earth-sized world."];
  const slides = ["Geneva astronomers ran 10,000 simulated orbits.", "A stable zone sits 1.2 AU from the larger star.", "ESPRESSO starts a follow-up search in 2027."];
  const body = "Geneva astronomers ran 10,000 simulated orbits. ESPRESSO starts a follow-up search in 2027.";
  const fetchImpl = async () => new Response(JSON.stringify({ data: { bodyHtml: `<p>${body}</p>` } }), { status: 200 });
  const agent = (...replies) => {
    const prompts = [];
    const spawnImpl = (bin, args, { input }) => { prompts.push(input); const r = replies[prompts.length - 1]; return typeof r === "string" ? { status: 0, stdout: r, stderr: "" } : r; };
    return { prompts, spawnImpl };
  };
  // the first summary retells headline and deck but for one slide: one rewrite, which wins
  const first = [...echo, slides[0]].join("\n");
  const a = agent(first, slides.join("\n"));
  assert.deepEqual(await summarizeStory(tenant, story, { spawnImpl: a.spawnImpl, fetchImpl }), slides);
  assert.equal(a.prompts.length, 2);
  assert.match(a.prompts[0], /^Summarise this story/);
  assert.equal(a.prompts[1], [
    "These slides for a vertical reel repeat the headline or the deck and were rejected:",
    `- ${echo[0]} (says nothing the headline and deck do not)`,
    `- ${echo[1]} (says nothing the headline and deck do not)`,
    "",
    "Rewrite them: 3-4 new slides with facts from the article that the headline and deck do not say: numbers, names, dates, what happens next. Do not repeat the rejected slides, the headline or the deck; no slide repeats another.",
    "Rules: short sentences (max 90 characters each), plain language, no emoji, no numbering, one sentence per slide.",
    `Only facts from the article: invent nothing, and keep the source's hedges ("allegedly", "according to"). If the article holds no other fact, write fewer slides.`,
    "Print ONLY the slides, one per line, nothing else.",
    "",
    `Headline: ${ITEM.title}`,
    `Deck: ${ITEM.dek}`,
    `Article: ${body}`,
  ].join("\n"));
  // the rewrite keeps no more than the first: the first stays
  const b = agent(first, echo.join("\n"));
  assert.deepEqual(await summarizeStory(tenant, story, { spawnImpl: b.spawnImpl, fetchImpl }), [...echo, slides[0]]);
  assert.equal(b.prompts.length, 2);
  // a rewrite that fails: the first stays, no throw
  const c = agent(first, { status: 1, stdout: "", stderr: "rate limited" });
  assert.deepEqual(await summarizeStory(tenant, story, { spawnImpl: c.spawnImpl, fetchImpl }), [...echo, slides[0]]);
  // two that survive: no second ask
  const d = agent([slides[0], slides[1], echo[0]].join("\n"));
  assert.deepEqual(await summarizeStory(tenant, story, { spawnImpl: d.spawnImpl, fetchImpl }), [slides[0], slides[1], echo[0]]);
  assert.equal(d.prompts.length, 1);
  // the daily loop's path: the rewritten slides on the reel and in the caption
  const e = agent(first, slides.join("\n"));
  const made = await createStoryCampaign(tenant, { story, fetchImpl, spawnImpl: e.spawnImpl, write: false, force: true });
  assert.deepEqual([made.campaign.copy.points, made.campaign.copy.captionPoints, made.campaign.copy.droppedPoints], [slides, slides, []]);
  assert.equal(made.campaign.duration, 22);
  // Italian
  const it = buildRewritePrompt({ language: "it" }, { title: "T", dek: "D", body: "B" }, [{ point: "Uno.", reason: "title" }, { point: "Due.", reason: "point" }]);
  assert.match(it, /^Queste slide per un reel verticale ripetono titolo o sommario \(Headline, Deck\) e sono state scartate:\n- Uno\. \(ripete il titolo\)\n- Due\. \(ripete un'altra slide\)\n/);
  assert.match(it, /Riscrivile: 3-4 slide nuove con i fatti dell'articolo/);
  assert.match(it, /non inventare nulla/);
  assert.ok(it.endsWith("Headline: T\nDeck: D\nArticle: B"), it);
});

test("storyPoints: the reel keeps up to 4 of the filtered points, the caption the first 3, from one list", () => {
  const five = [...NEW_FACTS, "Il sindaco incontra gli autotrasportatori giovedì alle 10."];
  const r = storyPoints(RAGUSA, scicliStory(), five);
  assert.deepEqual(r.kept, NEW_FACTS);
  assert.deepEqual(r.dropped, [{ point: five[4], reason: "max" }]);
  assert.deepEqual(storyPoints(RAGUSA, scicliStory(), undefined), { kept: [], dropped: [] });
  const c = campaignFromStory(RAGUSA, scicliStory(), { points: [SCICLI.points[0], NEW_FACTS[0], SCICLI.points[1], NEW_FACTS[1]] });
  assert.deepEqual(c.copy.points, NEW_FACTS.slice(0, 2));
  assert.deepEqual(c.copy.captionPoints, NEW_FACTS.slice(0, 2));
  assert.deepEqual(c.copy.droppedPoints.map((d) => d.reason), ["no new words", "dek"]);
  assert.equal(c.duration, 18);
});

test("story caption with points: the ones that add a fact, as • lines between the dek and the sources", () => {
  const points = [SCICLI.points[0], ...NEW_FACTS.slice(0, 3)];
  const c = campaignFromStory(RAGUSA, scicliStory(), { points });
  const body = c.posts.instagram_reel.body;
  assert.equal(body, `${SCICLI.title}\n\n${SCICLI.dek}\n\n• ${NEW_FACTS[0]}\n• ${NEW_FACTS[1]}\n• ${NEW_FACTS[2]}\n\nBasato su 2 fonti in 1 lingua.\n\nLa storia completa: ${SCICLI.url}\n\n#Ragusa #Sicilia #Cronaca #Notizie`);
  assert.deepEqual(c.copy.points, NEW_FACTS.slice(0, 3), "the reel shows the same points: the one that retells the title is on neither");
  assert.deepEqual(c.copy.captionPoints, NEW_FACTS.slice(0, 3));
  assert.deepEqual(c.copy.droppedPoints, [{ point: SCICLI.points[0], reason: "no new words" }]);
  assert.equal(c.duration, 22, "the reel's length from the kept points");
  for (const k of ["tiktok", "facebook_reel", "instagram_post"]) assert.equal(c.posts[k].body, body, k);
  assert.deepEqual(campaignRepetition(c), { ok: true, pairs: [] });
  // four new facts: three in the caption, four on the reel
  const four = campaignFromStory(RAGUSA, scicliStory(), { points: NEW_FACTS });
  assert.deepEqual(four.copy.captionPoints, NEW_FACTS.slice(0, 3));
  assert.deepEqual(four.copy.points, NEW_FACTS);
  assert.equal(four.duration, 27);
  assert.ok(!four.posts.instagram_reel.body.includes(NEW_FACTS[3]));
  // the X thread does not change with the points
  const plain = campaignFromStory(RAGUSA, scicliStory());
  assert.deepEqual(c.posts.twitter, plain.posts.twitter);
  const thread = composeThread({ title: SCICLI.title, dek: SCICLI.dek, url: SCICLI.url, limit: 280 });
  assert.deepEqual([c.posts.twitter.body, c.posts.twitter.thread], [thread.body, thread.thread]);
  // no AI points: no slides (never the dek split), and the caption is the one without points
  assert.deepEqual(plain.copy.points, []);
  assert.deepEqual(plain.copy.captionPoints, []);
  assert.equal(plain.posts.instagram_reel.body, `${SCICLI.title}\n\n${SCICLI.dek}\n\nBasato su 2 fonti in 1 lingua.\n\nLa storia completa: ${SCICLI.url}\n\n#Ragusa #Sicilia #Cronaca #Notizie`);
});

test("campaignFromStory enables twitter when in social.platforms", () => {
  const tenant = {
    slug: "alienwatch", name: "Alien Watch", site: "https://alienwatch.buzz/", language: "en", feed: FEED,
    social: { platforms: ["tiktok", "twitter"] },
  };
  const c = campaignFromStory(tenant, normalizeStory(ITEM, FEED));
  assert.equal(c.posts.twitter.enabled, true, "twitter should be enabled when in social.platforms");
  assert.equal(c.posts.twitter.media, "reel");
  assert.equal(c.posts.tiktok.enabled, true);
  assert.equal(c.posts.instagram_post.enabled, false, "instagram_post not in platforms");
});

test("fetchStories reads the feed through the mapping; createStoryCampaign writes the campaign once", async () => {
  const tenant = { ...loadTenant("acme"), feed: FEED };
  const fetchImpl = async (url) => { assert.equal(String(url), FEED.url); return new Response(JSON.stringify({ data: [ITEM, { ...ITEM, slug: "older", title: "Older" }] }), { status: 200 }); };
  const stories = await fetchStories(tenant, { fetchImpl });
  assert.equal(stories.length, 2);
  const r = await createStoryCampaign(tenant, { fetchImpl });
  assert.equal(r.name, "story-2026-10-05-modelling-study-suggests-nearby");
  assert.ok(existsSync(join(world.repo, "tenants", "acme", "campaigns", r.name, "campaign.json")));
  await assert.rejects(createStoryCampaign(tenant, { fetchImpl }), /already exists/);
  const second = await createStoryCampaign(tenant, { fetchImpl, index: 1, name: "older-one" });
  assert.equal(second.story.title, "Older");
});

test("campaign names: two stories with the same opening words never share a campaign", async () => {
  const tenant = { ...loadTenant("acme"), feed: FEED };
  const story = (slug, title) => ({ ...normalizeStory(ITEM, FEED), slug, title, date: "2026-10-07T08:00:00Z" });
  const trofeo = story("a-ragusa-il-quarto-trofeo-cappadona-1a2b3c4d", "A Ragusa il quarto Trofeo Cappadona");
  const made = await createStoryCampaign(tenant, { story: trofeo, summarize: false });
  assert.equal(made.name, "story-2026-10-07-a-ragusa-il-quarto");
  // a different story with the same four opening words gets its own name
  const anno = story("a-ragusa-il-quarto-anno-del-terziario-9f8e7d6c", "A Ragusa il quarto anno del terziario");
  assert.equal(campaignNameFor(tenant, anno), "story-2026-10-07-a-ragusa-il-quarto-9f8e7d6c");
  const other = await createStoryCampaign(tenant, { story: anno, summarize: false });
  assert.equal(other.campaign.story.slug, anno.slug);
  // the same story re-slugged by the feed (new content hash) keeps its campaign
  assert.equal(campaignNameFor(tenant, { ...trofeo, slug: "a-ragusa-il-quarto-trofeo-cappadona-ffff0000" }), made.name);
  await assert.rejects(createStoryCampaign(tenant, { story: { ...trofeo, slug: "a-ragusa-il-quarto-trofeo-cappadona-ffff0000" }, summarize: false }), /already exists/);
});

test("the AI summary pre-script: prompt, line parsing, agent run and fallback", async () => {
  const tenant = { slug: "acme", name: "Acme", site: "https://acme.example/", language: "it", feed: FEED };
  const prompt = buildSummaryPrompt(tenant, normalizeStory(ITEM, FEED));
  assert.match(prompt, /Riassumi questa notizia in 3-4 slide/);
  assert.match(prompt, /Headline: Modelling Suggests/);
  assert.match(prompt, /Deck: A modelled orbit/);
  // plain lines, list markers and a JSON-wrapped agent reply all parse to the same slides
  const slides = ["La filiera lattiero-casearia iblea si allea.",
    "Confcooperative Ragusa ha lanciato la sfida alla fiera FAM.",
    "Il 30 novembre produttori e operatori decidono come procedere."];
  assert.deepEqual(parseSummaryLines(slides.join("\n")), slides);
  assert.deepEqual(parseSummaryLines("\n- " + slides.join("\n* ") + "\n\n"), slides);
  assert.deepEqual(parseSummaryLines(JSON.stringify({ result: "1. " + slides.join("\n2) ") + "\n" })), slides);
  // a fake agent whose stdout we control
  const spawnImpl = (bin, args, opts) => {
    assert.equal(bin, "fake-agent");
    assert.match(opts.input, /Riassumi/);
    return { status: 0, stdout: JSON.stringify({ result: slides.join("\n") }), stderr: "" };
  };
  // the detail endpoint has no article for it: the summary goes on from headline and deck
  const noBody = async () => new Response("not found", { status: 404 });
  const got = await summarizeStory({ ...tenant, feed: { ...FEED, agent: { command: ["fake-agent"] } } }, normalizeStory(ITEM, FEED), { spawnImpl, fetchImpl: noBody });
  assert.deepEqual(got, slides);
  // no agent configured → null (the campaign has no points: title and close), nothing fetched
  const never = async () => assert.fail("no agent, no body fetch");
  assert.equal(await summarizeStory({ ...tenant, feed: { ...FEED, agent: null } }, normalizeStory(ITEM, FEED), { fetchImpl: never }), null);
  // one usable line and no article to rewrite it from: the one line stays (a reel with one slide)
  let asked = 0;
  assert.deepEqual(await summarizeStory({ ...tenant, feed: { ...FEED, agent: { command: ["fake-agent"] } } }, normalizeStory(ITEM, FEED),
    { spawnImpl: () => { asked++; return { status: 0, stdout: slides[0], stderr: "" }; }, fetchImpl: noBody }), [slides[0]]);
  assert.equal(asked, 1, "no article, no rewrite");
  // and a campaign built with the summary points uses them on the reel slides
  const c = campaignFromStory(tenant, normalizeStory(ITEM, FEED), { points: slides });
  assert.deepEqual(c.copy.points, slides);
  assert.equal(c.duration, 22);
});

test("the story template scaffolds with headline words, kicker, meta, brand and the fetched image", async () => {
  const tenant = loadTenant("acme");
  const campaign = { ...JSON.parse(readFileSync(join(world.repo, "tenants", "acme", "campaigns", "story-2026-10-05-modelling-study-suggests-nearby", "campaign.json"), "utf8")), name: "s", dir: join(world.repo, "tenants", "acme", "campaigns", "s") };
  const variants = resolveVariants(campaign);
  assert.deepEqual(Object.keys(variants).sort(), ["post", "reel"], "the story template drops the 16:9 variant by default");
  const fetchImpl = async () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
  const [reel] = await scaffold({ tenant, campaign, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "story"), fetchImpl });
  const html = readFileSync(join(reel.dir, "compositions", "story-reel.html"), "utf8");
  assert.match(html, /<span class="w">Modelling<\/span><span class="w">Suggests<\/span>/);
  assert.match(html, /Science &amp; Health · 5 Oct 2026/);
  assert.match(html, /2 sources · 2 languages/);
  assert.match(html, /src="assets\/story\.jpg"/);
  assert.match(html, /var HAS_PHOTO = true;/);
  assert.match(html, /<span class="part" style="font-weight: 300">Acme<\/span>/);
  assert.ok(existsSync(join(reel.dir, "assets", "story.jpg")));
  // no summary: title slide and close only, no empty point slide
  assert.deepEqual(campaign.copy.points, []);
  assert.match(html, /data-duration="13"/);
  assert.doesNotMatch(html, /point-scene/);
  assert.match(html, /var PN = 0;/);
  assert.match(html, /id="story-reel-s0"/);
  assert.match(html, /id="story-reel-sclose"/);
  // the end card: the source count, then where to read the whole story — never the dek again
  assert.match(html, /<span id="story-reel-end-num">2<\/span><span id="story-reel-end-label">sources<\/span>/);
  assert.match(html, /Read the full story on <span class="end-site">acme\.example<\/span>/);
  assert.doesNotMatch(html, /id="story-reel-dek"/);
  const noImage = await scaffold({ tenant, campaign: { ...campaign, image: null }, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "story2"), fetchImpl });
  assert.match(readFileSync(join(noImage[0].dir, "compositions", "story-reel.html"), "utf8"), /style="display: none"/);
  // an image that exists but cannot be fetched fails the scaffold — never a reel with an empty photo band
  const down = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(scaffold({ tenant, campaign, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "story3"), fetchImpl: down }), /story image unreachable/);
  const missing = async () => new Response("nope", { status: 404 });
  await assert.rejects(scaffold({ tenant, campaign, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "story4"), fetchImpl: missing }), /HTTP 404/);
});

test("the story reel with 0, 1 or 2 points: one slide per kept point, none empty, the scene times inside the reel", async () => {
  const tenant = loadTenant("acme");
  const story = { ...normalizeStory(ITEM, FEED), image: null };
  const facts = ["Geneva astronomers ran 10,000 simulated orbits.", "ESPRESSO starts a follow-up search in 2027."];
  const echo = "Modelling suggests 70 Ophiuchi could host an Earth-sized planet.";
  for (const [given, n, duration] of [[[echo], 0, 13], [[echo, facts[0]], 1, 13], [[facts[0], echo, facts[1]], 2, 18]]) {
    const campaign = { ...campaignFromStory(tenant, story, { points: given }), name: `pts-${n}` };
    assert.equal(campaign.copy.points.length, n);
    assert.equal(campaign.duration, duration);
    const [reel] = await scaffold({ tenant, campaign, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, `story-pts-${n}`) });
    const html = readFileSync(join(reel.dir, "compositions", "story-reel.html"), "utf8");
    assert.match(html, new RegExp(`data-duration="${duration}"`));
    assert.match(html, new RegExp(`var PN = ${n};`));
    const scenes = [...html.matchAll(/<div class="scene point-scene" id="story-reel-s(\d)">.*?<p class="p-text">(.*?)<\/p><\/div>/g)];
    assert.deepEqual(scenes.map((m) => [Number(m[1]), m[2]]), campaign.copy.points.map((p, i) => [i + 1, p]), "one filled slide per kept point");
    assert.doesNotMatch(html, /__[A-Z][A-Z0-9_]*__/, "every token is filled");
    // the template's scene budget (title 5 s, close 4 s, a point ≥ 3.6 s): the close starts
    // inside the reel and holds at least its 4 s
    const tPoint = n > 0 ? Math.max(3.6, (duration - 5 - 4) / n) : 0;
    const closeAt = 5 + n * tPoint;
    assert.ok(closeAt + 4 <= duration + 1e-9, `${n} points: close at ${closeAt}s of ${duration}s`);
    assert.match(html, /var tTitle = 5, tClose = 4;/);
    assert.match(html, /var tPoint = PN > 0 \? Math\.max\(3\.6, \(DUR - tTitle - tClose\) \/ PN\) : 0;/);
  }
});

test("the end card speaks the tenant's language and reads the count from the meta line", () => {
  assert.deepEqual(endCard("it", 3, "ragusa.buzz"), { num: "3", label: "fonti", cta: 'Vai su <span class="end-site">ragusa.buzz</span> per leggere tutta la notizia' });
  assert.equal(endCard("it", 1, "ragusa.buzz").label, "fonte");
  assert.deepEqual(endCard("en", 1, "alienwatch.buzz"), { num: "1", label: "source", cta: 'Read the full story on <span class="end-site">alienwatch.buzz</span>' });
  assert.deepEqual(endCard("en", null, ""), { num: "", label: "", cta: "" });
  assert.equal(sourceCount({ meta: "3 fonti · 1 lingua" }), 3);
  assert.equal(sourceCount({ sources: 5, meta: "3 fonti" }), 5);
  assert.equal(sourceCount({}), null);
});

test("the intro template: four grids the timeline refills, every image preloaded, the brand wordmark as it is", async () => {
  const tenant = loadTenant("acme");
  const campaign = {
    name: "launch", dir: join(world.repo, "tenants", "acme", "campaigns", "launch"), template: "intro", language: "it", duration: 10,
    copy: { tagline: "Il riassunto della provincia", url: "acme.example" },
    images: ["https://acme.example/a.jpg", "https://acme.example/b.png", "https://acme.example/c.jpg"],
  };
  const fetchImpl = async () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
  assert.deepEqual(Object.keys(resolveVariants(campaign)), ["reel"], "vertical only");
  const [reel] = await scaffold({ tenant, campaign, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "intro"), fetchImpl });
  for (const f of ["page-01.jpg", "page-02.png", "page-03.jpg"]) assert.ok(existsSync(join(reel.dir, "assets", f)), f);
  const html = readFileSync(join(reel.dir, "compositions", "intro-reel.html"), "utf8");
  assert.equal([...html.matchAll(/<div class="grid">/g)].length, 4);
  assert.equal([...html.matchAll(/<div class="panel">/g)].length, 4 * 6 * 3, "four grids of 6 rows × 3");
  assert.match(html, /var IMGS = \["assets\/page-01\.jpg","assets\/page-02\.png","assets\/page-03\.jpg"\];/);
  assert.equal([...html.matchAll(/<img src="assets\/page-0\d\.\w+" alt="" \/>/g)].length, 3, "every image preloaded");
  assert.match(html, /transform: rotate\(-45deg\)/);
  assert.match(html, /<p class="wordmark" id="intro-reel-wordmark"><span class="part" style="font-weight: 300">Acme<\/span><span class="part" style="font-weight: 600">Corp<\/span><span class="b-dot"><\/span><\/p>/, "the brand's own wordmark, dot included");
  assert.match(html, /<p class="tagline" id="intro-reel-tagline">Il riassunto della provincia<\/p>/);
  assert.doesNotMatch(html, /__[A-Z][A-Z0-9_]*__/, "every token is filled");
  // a re-render after the list changed shows the new images, never the files left by the last one
  const other = async () => new Response(Buffer.from("new-image"), { status: 200 });
  await scaffold({ tenant, campaign: { ...campaign, images: ["https://acme.example/z.jpg"] }, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "intro"), fetchImpl: other });
  assert.equal(readFileSync(join(reel.dir, "assets", "page-01.jpg"), "utf8"), "new-image");
});
