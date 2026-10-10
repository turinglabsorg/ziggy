import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { campaignFromStory, campaignNameFor, fetchStories, normalizeStory, pick, slugify, createStoryCampaign, buildSummaryPrompt, parseSummaryLines, summarizeStory } from "../scripts/story.mjs";
import { endCard, resolveVariants, scaffold, sourceCount } from "../scripts/video.mjs";
import { makeWorld } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;
const { loadTenant } = await import("../scripts/config.mjs");

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
  assert.equal(c.posts.twitter.media, "slide-cover");
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
  assert.deepEqual(c.copy.points, ["A modelled orbit could sustain an Earth-sized world, but no planet has been detected."]);
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
  const got = await summarizeStory({ ...tenant, feed: { ...FEED, agent: { command: ["fake-agent"] } } }, normalizeStory(ITEM, FEED), { spawnImpl });
  assert.deepEqual(got, slides);
  // no agent configured → null (createStoryCampaign falls back to the dek split)
  assert.equal(await summarizeStory({ ...tenant, feed: { ...FEED, agent: null } }, normalizeStory(ITEM, FEED)), null);
  // one usable line is not a summary → null
  assert.equal(await summarizeStory({ ...tenant, feed: { ...FEED, agent: { command: ["fake-agent"] } } }, normalizeStory(ITEM, FEED),
    { spawnImpl: () => ({ status: 0, stdout: slides[0], stderr: "" }) }), null);
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
  assert.match(html, /data-duration="13"/);
  assert.match(html, /class="scene point-scene" id="story-reel-s1"/);
  assert.match(html, /var PN = 1;/);
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
  assert.match(html, /<p class="wordmark" id="intro-reel-wordmark"><span class="part" style="font-weight: 300">Acme<\/span><span class="part" style="font-weight: 600">Corp<\/span><\/p>/, "the brand's own wordmark");
  assert.match(html, /<p class="tagline" id="intro-reel-tagline">Il riassunto della provincia<\/p>/);
  assert.doesNotMatch(html, /__[A-Z][A-Z0-9_]*__/, "every token is filled");
  // a re-render after the list changed shows the new images, never the files left by the last one
  const other = async () => new Response(Buffer.from("new-image"), { status: 200 });
  await scaffold({ tenant, campaign: { ...campaign, images: ["https://acme.example/z.jpg"] }, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "intro"), fetchImpl: other });
  assert.equal(readFileSync(join(reel.dir, "assets", "page-01.jpg"), "utf8"), "new-image");
});
