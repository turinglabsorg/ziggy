import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { coveredStories, dailyConfig, freeSlotTimes, livePosts, storyCovered, titleTokens, uncoveredStories } from "../scripts/daily.mjs";
import { API_KEY, makeWorld, runCli, startMockPostproxy } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;
const { fontsDir, tenantDir } = await import("../scripts/config.mjs");

mkdirSync(fontsDir("acme"), { recursive: true });
for (const f of ["Unbounded", "Geist", "GeistMono"]) writeFileSync(join(fontsDir("acme"), `${f}.woff2`), Buffer.alloc(64, 0));

test("daily config: tenant overrides land on top of the defaults", () => {
  assert.deepEqual(dailyConfig({}), { slots: ["07:30", "13:00", "17:30", "20:00"], tz: "+02:00", maxAgeHours: 48, only: ["instagram_reel"] });
  assert.deepEqual(dailyConfig({ daily: { slots: ["08:00"], tz: "-05:00" } }).slots, ["08:00"]);
  assert.equal(dailyConfig({ daily: { tz: "-05:00" } }).tz, "-05:00");
});

test("free slots: strictly after `from`, in the tenant's fixed offset, skipping our taken ones", () => {
  // 21:00 local (+02:00) → every slot lands tomorrow
  const evening = freeSlotTimes(["07:30", "13:00"], "+02:00", { from: new Date("2026-10-06T19:00:00Z") });
  assert.deepEqual(evening, ["2026-10-07T05:30:00.000Z", "2026-10-07T11:00:00.000Z"]);
  // 06:00 local → the 07:30 slot lands today, the others too
  const dawn = freeSlotTimes(["07:30", "13:00"], "+02:00", { from: new Date("2026-10-06T04:00:00Z") });
  assert.deepEqual(dawn, ["2026-10-06T05:30:00.000Z", "2026-10-06T11:00:00.000Z"]);
  // between slots: 13:00 is today, 07:30 tomorrow — in time order
  const noon = freeSlotTimes(["07:30", "13:00"], "+02:00", { from: new Date("2026-10-06T08:00:00Z") });
  assert.deepEqual(noon, ["2026-10-06T11:00:00.000Z", "2026-10-07T05:30:00.000Z"]);
  // a slot holding one of our posts is skipped, and nothing lands past the 24h horizon
  const taken = new Set([Date.parse("2026-10-07T05:30:00.000Z")]);
  assert.deepEqual(freeSlotTimes(["07:30", "13:00"], "+02:00", { from: new Date("2026-10-06T19:00:00Z"), taken }), ["2026-10-07T11:00:00.000Z"]);
  assert.deepEqual(freeSlotTimes(["07:30"], "+02:00", { from: new Date("2026-10-06T19:00:00Z"), taken }), []);
});

let mock, feedServer, feedPort, items;
before(async () => {
  mock = await startMockPostproxy();
  items = [
    { title: "Harbour reopens after the storm", dek: "Something happened today in town.", storyDate: "2026-10-06T09:00:00Z", sector: { name: "Cronaca" }, imageUrl: "__FEED__/img.jpg", slug: "fresh-story-one", sourceCount: 2, languageCount: 1 },
    { title: "Council approves the school budget", dek: "Another thing happened in the afternoon.", storyDate: "2026-10-06T14:00:00Z", sector: { name: "Economia" }, imageUrl: "__FEED__/img.jpg", slug: "fresh-story-two", sourceCount: 1, languageCount: 1 },
    { title: "Stale story", dek: "This happened days ago.", storyDate: "2026-10-02T09:00:00Z", sector: { name: "Sport" }, imageUrl: "__FEED__/img.jpg", slug: "stale-story", sourceCount: 1, languageCount: 1 },
  ];
  feedServer = createServer((req, res) => {
    if (req.url === "/img.jpg") { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: items.map((it) => ({ ...it, imageUrl: it.imageUrl.replace("__FEED__", `http://127.0.0.1:${feedPort}`) })) }));
  });
  feedServer.keepAliveTimeout = 120_000; // see helpers.mjs: no keep-alive race under load
  feedServer.headersTimeout = 121_000;
  await new Promise((r) => feedServer.listen(0, "127.0.0.1", r));
  feedPort = feedServer.address().port;

  const tenantFile = join(tenantDir("acme"), "tenant.json");
  const tenant = JSON.parse(readFileSync(tenantFile, "utf8"));
  tenant.feed = {
    url: `http://127.0.0.1:${feedPort}/feed`, items: "data",
    fields: { title: "title", dek: "dek", section: "sector.name", date: "storyDate", image: "imageUrl", slug: "slug", sources: "sourceCount", languages: "languageCount" },
    storyUrl: "https://acme.example/#/b/{slug}", displayUrl: "acme.example",
    agent: null,
  };
  tenant.daily = { slots: ["07:30", "13:00", "17:30", "20:00"], tz: "+02:00" };
  writeFileSync(tenantFile, JSON.stringify(tenant, null, 2));
});
after(() => new Promise((r) => { feedServer.closeAllConnections(); feedServer.close(r); mock.close(); }));

const ENV = () => ({ ...world.env, ZIGGY_POSTPROXY_BASE_URL: mock.baseUrl, POSTPROXY_API_KEY: API_KEY, ZIGGY_HYPERFRAMES_BIN: fakeBin });

let fakeBin;
before(() => {
  const dir = join(world.root, "fakehf-daily");
  mkdirSync(dir, { recursive: true });
  fakeBin = join(dir, "hyperframes");
  writeFileSync(fakeBin, `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "check") { console.log("ok"); process.exit(0); }
if (cmd === "render") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, "mp4"); process.exit(0); }
if (cmd === "snapshot") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(o, { recursive: true }); fs.writeFileSync(path.join(o, "frame-00-at-7s.png"), "png"); process.exit(0); }
if (cmd === "--version") { console.log("0.8.133"); process.exit(0); }
process.exit(1);
`);
  chmodSync(fakeBin, 0o755);
});

test("the daily loop: fresh stories become campaigns, rendered and scheduled on the next slots", async () => {
  const r = await runCli(["daily", "acme", "--from", "2026-10-06T19:00:00Z", "--json"], ENV());
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.planned.length, 2, `two fresh stories, the stale one is ignored — errors: ${JSON.stringify(report.errors)}`);
  assert.deepEqual(report.planned.map((p) => p.scheduledAt), ["2026-10-07T05:30:00.000Z", "2026-10-07T11:00:00.000Z"]);
  assert.deepEqual(report.errors, []);
  const creates = mockCalls().filter((x) => x.method === "POST" && x.path === "/api/posts");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates.map((c) => c.fields["post[scheduled_at]"]), ["2026-10-07T05:30:00.000Z", "2026-10-07T11:00:00.000Z"]);
  // second run: everything is covered, nothing is created again
  const postsBefore = mockCalls().filter((x) => x.method === "POST" && x.path === "/api/posts").length;
  const again = await runCli(["daily", "acme", "--from", "2026-10-06T19:05:00Z"], ENV());
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /nothing new/);
  assert.equal(mockCalls().filter((x) => x.method === "POST" && x.path === "/api/posts").length, postsBefore);
});

test("the daily loop never stacks stories on one slot: a later run takes the next free one", async () => {
  items.unshift({ title: "Night market draws record crowds", dek: "A third thing happened in the evening.", storyDate: "2026-10-06T18:00:00Z", sector: { name: "Cronaca" }, imageUrl: "__FEED__/img.jpg", slug: "fresh-story-three", sourceCount: 1, languageCount: 1 });
  const r = await runCli(["daily", "acme", "--from", "2026-10-06T19:10:00Z", "--json"], ENV());
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.planned.map((p) => [p.title, p.scheduledAt]), [["Night market draws record crowds", "2026-10-07T15:30:00.000Z"]], "07:30 and 13:00 already hold stories one and two");
});

test("a deleted post frees its slot and uncovers its story: the next run redoes both", async () => {
  const log = readFileSync(join(world.home, "tenants", "acme", "posts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const first = log.find((x) => x.scheduledAt === "2026-10-07T05:30:00.000Z");
  const del = await runCli(["delete", "acme", first.postId], ENV());
  assert.equal(del.status, 0, del.stderr);
  const r = await runCli(["daily", "acme", "--from", "2026-10-06T19:20:00Z", "--json"], ENV());
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.planned.map((p) => [p.campaign, p.scheduledAt]), [[first.campaign, "2026-10-07T05:30:00.000Z"]]);
});

function mockCalls() { return mock.calls; }

test("ziggy reschedule moves a scheduled post on Postproxy and in the slot accounting", async () => {
  const target = livePosts("acme").find((x) => x.scheduledAt === "2026-10-07T15:30:00.000Z");
  assert.ok(target, "the night market story from the stacking test");
  const r = await runCli(["reschedule", "acme", target.postId, "--at", "2026-10-07T21:15:00Z"], ENV());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`${target.postId}  → 2026-10-07T21:15:00.000Z`));
  const patch = mock.calls.filter((c) => c.method === "PATCH").at(-1);
  assert.equal(patch.path, `/api/posts/${target.postId}`);
  assert.equal(mock.state.posts[target.postId].scheduled_at, "2026-10-07T21:15:00.000Z");
  assert.equal(livePosts("acme").find((x) => x.postId === target.postId).scheduledAt, "2026-10-07T21:15:00.000Z");
  // the slot it left is free again, the new one is taken
  const free = freeSlotTimes(["17:30", "23:15"], "+02:00", { from: new Date("2026-10-07T12:00:00Z"), taken: new Set(livePosts("acme").map((x) => Date.parse(x.scheduledAt))) });
  assert.deepEqual(free, ["2026-10-07T15:30:00.000Z"]);
  const bad = await runCli(["reschedule", "acme", target.postId], ENV());
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /usage: ziggy reschedule/);
});

test("a campaign marked skip covers its story without any post: the loop leaves it alone", () => {
  const dir = join(world.repo, "tenants", "acme", "campaigns", "story-2026-10-07-confronto-pubblico-ieri");
  mkdirSync(dir, { recursive: true });
  const story = { slug: "confronto-pubblico-ieri-6d6c2f52", title: "Confronto pubblico ieri sera in piazza" };
  writeFileSync(join(dir, "campaign.json"), JSON.stringify({ template: "story", story: { slug: story.slug }, copy: { headline: story.title } }));
  assert.equal(storyCovered(story, coveredStories("acme")), false, "no post, no skip: still to do");
  writeFileSync(join(dir, "campaign.json"), JSON.stringify({ template: "story", skip: true, story: { slug: story.slug }, copy: { headline: story.title } }));
  assert.equal(storyCovered(story, coveredStories("acme")), true);
});

test("storyCovered: story ID matching is primary check", () => {
  const covered = [
    { slug: "petizione-a-ragusa-roditori-71903f2c-8e18e4cd", storyId: "71903f2c", tokens: new Set(["petizione", "ragusa", "roditori"]) }
  ];
  // Same story ID → covered
  assert.equal(storyCovered({ slug: "petizione-a-ragusa-roditori-71903f2c-8e18e4cd", title: "Petizione a Ragusa per i roditori" }, covered), true);
  // Same story ID but renamed → still covered
  assert.equal(storyCovered({ slug: "petizione-a-ragusa-topi-71903f2c-99999999", title: "Petizione a Ragusa per i topi" }, covered), true);
  // Different story ID → not covered
  assert.equal(storyCovered({ slug: "confcooperative-ragusa-evento-12345678-87654321", title: "Confcooperative Ragusa organizza evento per le imprese" }, covered), false);
});

test("storyCovered: false-positive examples must NOT be covered", () => {
  const placeNames = ["Ragusa", "Modica", "Comiso", "Scicli", "Vittoria", "Acate"];
  
  // Example 1: 'Petizione a Ragusa… roditori' should NOT be blocked by 'Confcooperative Ragusa…'
  const covered1 = [
    { slug: "confcooperative-ragusa-evento-12345678-87654321", storyId: "12345678", tokens: new Set(["confcooperative", "evento", "imprese"]) }
  ];
  assert.equal(
    storyCovered({ slug: "petizione-a-ragusa-roditori-71903f2c-8e18e4cd", title: "Petizione a Ragusa per i roditori" }, covered1, placeNames),
    false,
    "Generic words (ragusa, per) should not cause false positive"
  );
  
  // Example 2: 'Comiso approva tre misure… tributi' should NOT be blocked by 'Incidente a Comiso…'
  const covered2 = [
    { slug: "incidente-a-comiso-auto-12345678-87654321", storyId: "12345678", tokens: new Set(["incidente", "auto", "feriti"]) }
  ];
  assert.equal(
    storyCovered({ slug: "comiso-approva-tre-misure-tributi-71903f2c-8e18e4cd", title: "Comiso approva tre misure per i tributi" }, covered2, placeNames),
    false,
    "Generic words (comiso, dei/per, tre) should not cause false positive"
  );
  
  // Example 3: 'Una targa a Modica… crollo 1951' should NOT be blocked by 'Pnrr a Modica apre la palestra'
  const covered3 = [
    { slug: "pnrr-a-modica-palestra-12345678-87654321", storyId: "12345678", tokens: new Set(["pnrr", "palestra", "sport"]) }
  ];
  assert.equal(
    storyCovered({ slug: "una-targa-a-modica-crollo-1951-71903f2c-8e18e4cd", title: "Una targa a Modica per il crollo del 1951" }, covered3, placeNames),
    false,
    "Generic words (una, modica, due) should not cause false positive"
  );
});

test("storyCovered: true duplicates must be covered", () => {
  const placeNames = ["Ragusa", "Modica", "Comiso", "Giarratana", "Scicli"];
  
  // Example 1: Same De Chirico at MACC story - meaningful tokens: chirico, macc, opere
  const covered1 = [
    { slug: "de-chirico-mostra-macc-ragusa-12345678-87654321", storyId: "12345678", tokens: new Set(["chirico", "mostra", "macc", "opere"]) }
  ];
  // New story has: chirico, macc, esposizione, opere → 3 shared tokens (chirico, macc, opere), 75% match
  assert.equal(
    storyCovered({ slug: "de-chirico-macc-esposizione-opere-99999999-11111111", title: "De Chirico al MACC: esposizione delle opere" }, covered1, placeNames),
    true,
    "Same story (De Chirico at MACC) should be detected despite rewording"
  );
  
  // Example 2: Same Giarratana Volley story - meaningful tokens overlap
  const covered2 = [
    { slug: "giarratana-volley-vittoria-campionato-serie-12345678-87654321", storyId: "12345678", tokens: new Set(["volley", "vittoria", "campionato", "serie"]) }
  ];
  // New story has: volley, vince, campionato, serie → 3 shared tokens (volley, campionato, serie), 75% match
  assert.equal(
    storyCovered({ slug: "giarratana-volley-vince-campionato-serie-99999999-11111111", title: "Giarratana Volley vince il campionato di Serie B" }, covered2, placeNames),
    true,
    "Same story (Giarratana Volley) should be detected"
  );
  
  // Example 3: Same story, high overlap of meaningful tokens
  const covered3 = [
    { slug: "scicli-restauro-chiesa-san-bartolomeo-12345678-87654321", storyId: "12345678", tokens: new Set(["restauro", "chiesa", "bartolomeo", "finanziamento"]) }
  ];
  assert.equal(
    storyCovered({ slug: "scicli-chiesa-san-bartolomeo-restauro-regionale-99999999-11111111", title: "Scicli: restauro della chiesa di San Bartolomeo con finanziamento regionale" }, covered3, placeNames),
    true,
    "Same story with high token overlap should be covered"
  );
});

test("storyCovered: near-duplicates with rare tokens (amounts, distinctive words)", () => {
  const placeNames = ["Ragusa", "Modica"];
  
  // Example 1: Same event, different angles - '900mila euro per il centro storico'
  const covered1 = [
    { slug: "900mila-euro-centro-storico-gurrieri-difende-12345678-87654321", storyId: "12345678", tokens: new Set(["900mila", "euro", "centro", "storico", "gurrieri", "difende"]) }
  ];
  // Different briefing about the same event: opposition contests the bonus
  assert.equal(
    storyCovered({ slug: "opposizione-contesta-bonus-900mila-euro-centro-storico-99999999-11111111", title: "Ragusa, l'opposizione contesta il bonus da 900mila euro per il centro storico" }, covered1, placeNames),
    true,
    "Near-duplicate with rare tokens (900mila, euro) should be detected"
  );
  
  // Example 2: Amounts should match even with different context
  const covered2 = [
    { slug: "finanziamento-500mila-euro-biblioteca-12345678-87654321", storyId: "12345678", tokens: new Set(["finanziamento", "500mila", "euro", "biblioteca"]) }
  ];
  assert.equal(
    storyCovered({ slug: "biblioteca-riceve-500mila-euro-regione-99999999-11111111", title: "La biblioteca riceve 500mila euro dalla Regione" }, covered2, placeNames),
    true,
    "Near-duplicate with amount tokens (500mila, euro) should be detected"
  );
  
  // Example 3: Single rare token is not enough
  const covered3 = [
    { slug: "investimento-900mila-opere-pubbliche-12345678-87654321", storyId: "12345678", tokens: new Set(["investimento", "900mila", "opere", "pubbliche"]) }
  ];
  assert.equal(
    storyCovered({ slug: "scuola-richiede-900mila-ristrutturazione-99999999-11111111", title: "La scuola richiede 900mila per la ristrutturazione" }, covered3, placeNames),
    false,
    "Single rare token (900mila) without other matches should not be enough"
  );
});

test("titleTokens: multi-word place names are split into individual tokens", () => {
  const placeNames = ["Santa Croce Camerina", "Monterosso Almo", "Ragusa"];
  const tokens = titleTokens("Incidente a Santa Croce Camerina sulla via principale", placeNames);
  // "santa", "croce", "camerina" should all be filtered out
  assert.ok(!tokens.has("santa"));
  assert.ok(!tokens.has("croce"));
  assert.ok(!tokens.has("camerina"));
  assert.ok(!tokens.has("ragusa"));
  // "incidente", "principale" should remain (>3 chars, not stopwords/places)
  assert.ok(tokens.has("incidente"));
  assert.ok(tokens.has("principale"));
});
