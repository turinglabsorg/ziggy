import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { campaignFromStory, fetchStories, normalizeStory, pick, slugify, createStoryCampaign, buildSummaryPrompt, parseSummaryLines, summarizeStory } from "../scripts/story.mjs";
import { resolveVariants, scaffold } from "../scripts/video.mjs";
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
  assert.match(c.posts.instagram_reel.body, /Comment LINK/);
  assert.equal(c.posts.instagram_reel.first_comment, "Comment LINK and we'll DM you the full story with sources.");
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
    social: { cta: "La storia completa: {site} (link in bio).", hashtags: "#Ragusa #Sicilia", linkComment: "Commenta LINK e te la mandiamo in DM." },
  };
  const c = campaignFromStory(tenant, normalizeStory(ITEM, FEED));
  assert.match(c.posts.instagram_reel.body, /Basato su 2 fonti in 2 lingue\./);
  assert.match(c.posts.instagram_reel.body, /La storia completa: acme\.example \(link in bio\)\./);
  assert.match(c.posts.instagram_reel.body, /#Ragusa #Sicilia$/);
  assert.ok(!c.posts.instagram_reel.body.includes("#UFO"));
  assert.equal(c.posts.instagram_reel.first_comment, "Commenta LINK e te la mandiamo in DM.");
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
  const noImage = await scaffold({ tenant, campaign: { ...campaign, image: null }, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "story2"), fetchImpl });
  assert.match(readFileSync(join(noImage[0].dir, "compositions", "story-reel.html"), "utf8"), /style="display: none"/);
});
