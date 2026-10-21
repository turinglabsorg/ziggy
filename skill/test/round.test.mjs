import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { pointProblems, roundConfig, storyDeadline } from "../scripts/round.mjs";
import { API_KEY, fakeStoryAgent, makeWorld, runCli, startMockPostproxy } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;
const { fontsDir, tenantDir } = await import("../scripts/config.mjs");

mkdirSync(fontsDir("acme"), { recursive: true });
for (const f of ["Unbounded", "Geist", "GeistMono"]) writeFileSync(join(fontsDir("acme"), `${f}.woff2`), Buffer.alloc(64, 0));

const NEXT_DAY = { daily: { tz: "+02:00", only: ["instagram_reel"], freshness: "next-day", round: { times: Array.from({ length: 16 }, (_, h) => `${String(h + 8).padStart(2, "0")}:00`), gapMinutes: 55 } } };
const WITH_CASEFILE = { ...NEXT_DAY, casefile: { enabled: true, maxPerDay: 1, onlyWhenQueueBelow: 3 } };

test("round config: tenant rules, with the daily slots as the fallback times", () => {
  const cfg = roundConfig(NEXT_DAY);
  assert.equal(cfg.freshness, "next-day");
  assert.equal(cfg.times.length, 16);
  assert.equal(cfg.gapMs, 55 * 60_000);
  const plain = roundConfig({ daily: { slots: ["07:00", "19:00"], tz: "Z", freshness: "archive" } });
  assert.deepEqual([plain.freshness, plain.times, plain.gapMs], ["archive", ["07:00", "19:00"], 60 * 60_000]);
});

test("deadline: the end of the day after the story's date, in the tenant's time; none for an archive tenant", () => {
  const cfg = roundConfig(NEXT_DAY);
  assert.equal(new Date(storyDeadline(cfg, "2026-10-11T09:00:00Z")).toISOString(), "2026-10-12T21:59:00.000Z");
  // 23:30 local on the 11th is still the 11th: the deadline is the 12th, not the 13th
  assert.equal(new Date(storyDeadline(cfg, "2026-10-11T21:30:00Z")).toISOString(), "2026-10-12T21:59:00.000Z");
  assert.equal(storyDeadline(roundConfig({ daily: { freshness: "archive" } }), "2026-10-11T09:00:00Z"), Infinity);
});

test("planRound with archive flag includes stories with deadlines still in the future", async () => {
  const { planRound } = await import("../scripts/round.mjs");
  const { loadTenant } = await import("../scripts/config.mjs");
  
  // Without --archive: only stories within deadline
  const normalPlan = await planRound(loadTenant("acme"), { now: new Date("2026-10-12T08:00:00Z") });
  const normalTitles = normalPlan.map((s) => s.title);
  // Story from 2026-10-11 has deadline of end of 2026-10-12, still valid
  assert.ok(normalTitles.includes("Harbour reopens after the storm"));
  // Story from 2026-10-12 also valid
  assert.ok(normalTitles.includes("Council approves the school budget"));
  
  // With --archive: includes all stories not past their deadline
  const archivePlan = await planRound(loadTenant("acme"), { now: new Date("2026-10-12T08:00:00Z"), archive: true });
  const archiveTitles = archivePlan.map((s) => s.title);
  assert.ok(archiveTitles.includes("Harbour reopens after the storm"));
  assert.ok(archiveTitles.includes("Council approves the school budget"));
  
  // Old story from 2026-10-09 with deadline of 2026-10-10 should not be included
  assert.ok(!archiveTitles.includes("Autumn fair closes its doors"));
});

test("points: 3 or 4, none empty, none over 90 characters", () => {
  assert.deepEqual(pointProblems(["a", "b", "c", "d"]), []);
  assert.deepEqual(pointProblems(["a", "b", "c"]), []);
  assert.match(pointProblems(["a", "b"])[0], /3–4 points/);
  assert.match(pointProblems(["a", "b", "c", "d", "e"])[0], /3–4 points/);
  assert.match(pointProblems(["a", " ", "c"])[0], /point 2 is empty/);
  assert.match(pointProblems(["a", "b", "x".repeat(91)])[0], /point 3 is 91 characters/);
});

let mock, feedServer, feedPort, items;
const telegram = [];
const img = (s) => s && `__FEED__/${s}.jpg`;
before(async () => {
  mock = await startMockPostproxy();
  items = [
    { title: "Harbour reopens after the storm", dek: "The port authority lifted the ban this morning.", storyDate: "2026-10-11T09:00:00Z", sector: { name: "Cronaca" }, imageUrl: img("a"), slug: "harbour-reopens-after-the-storm", sourceCount: 3, languageCount: 1,
      bodyHtml: "<p>The ban ended at 6:00, when the wind dropped under 20 knots.</p><p>Ferries to Linosa restart on Tuesday &amp; the fish market reopens on Wednesday.</p>" },
    { title: "Council approves the school budget", dek: "Twelve votes in favour, four against.", storyDate: "2026-10-12T07:00:00Z", sector: { name: "Politica" }, imageUrl: img("b"), slug: "council-approves-the-school-budget", sourceCount: 2, languageCount: 1 },
    { title: "Autumn fair closes its doors", dek: "Three days of stalls.", storyDate: "2026-10-09T09:00:00Z", sector: { name: "Eventi" }, imageUrl: img("c"), slug: "autumn-fair-closes-its-doors", sourceCount: 1, languageCount: 1 },
    { title: "Night market draws record crowds", dek: "Stalls stayed open past midnight.", storyDate: "2026-10-12T08:00:00Z", sector: { name: "Cronaca" }, imageUrl: null, slug: "night-market-draws-record-crowds", sourceCount: 1, languageCount: 1 },
    { title: "Concert announced for tonight downtown", dek: "Doors open at nine.", storyDate: "2026-10-12T06:00:00Z", sector: { name: "Eventi" }, imageUrl: img("e"), slug: "concert-announced-for-tonight-downtown", sourceCount: 1, languageCount: 1 },
  ];
  feedServer = createServer(async (req, res) => {
    if (req.url.endsWith(".jpg")) { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
    if (req.method === "POST" && req.url.startsWith("/bottg-token/sendMessage")) {
      const chunks = []; for await (const c of req) chunks.push(c);
      telegram.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true }));
    }
    // the per-story endpoint: the article for a story that has one, 404 for the rest
    const detail = /^\/feed\/([^/?]+)/.exec(req.url);
    if (detail) {
      const it = items.find((x) => x.slug === decodeURIComponent(detail[1]));
      if (!it?.bodyHtml) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: { slug: it.slug, title: it.title, bodyHtml: it.bodyHtml } }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: items.map(({ bodyHtml, ...it }) => ({ ...it, imageUrl: it.imageUrl && it.imageUrl.replace("__FEED__", `http://127.0.0.1:${feedPort}`) })) }));
  });
  feedServer.keepAliveTimeout = 120_000; // see helpers.mjs: no keep-alive race under load
  feedServer.headersTimeout = 121_000;
  await new Promise((r) => feedServer.listen(0, "127.0.0.1", r));
  feedPort = feedServer.address().port;

  const tenantFile = join(tenantDir("acme"), "tenant.json");
  const tenant = JSON.parse(readFileSync(tenantFile, "utf8"));
  tenant.feed = {
    url: `http://127.0.0.1:${feedPort}/feed?limit=20`, items: "data",
    fields: { title: "title", dek: "dek", section: "sector.name", date: "storyDate", image: "imageUrl", slug: "slug", sources: "sourceCount", languages: "languageCount" },
    storyUrl: "https://acme.example/#/b/{slug}", displayUrl: "acme.example",
    agent: null,
  };
  Object.assign(tenant, NEXT_DAY);
  writeFileSync(tenantFile, JSON.stringify(tenant, null, 2));
});
after(() => new Promise((r) => { feedServer.closeAllConnections(); feedServer.close(r); mock.close(); }));

// fake renderer + ffprobe/ffmpeg: FAKE_AUDIO=none renders a reel without a sound track
let bins;
before(() => {
  bins = join(world.root, "fakebin-round");
  mkdirSync(bins, { recursive: true });
  const write = (name, body) => { writeFileSync(join(bins, name), body); chmodSync(join(bins, name), 0o755); };
  write("hyperframes", `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "check") { console.log("ok"); process.exit(0); }
if (cmd === "render") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, "mp4"); process.exit(0); }
if (cmd === "snapshot") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(o, { recursive: true }); fs.writeFileSync(path.join(o, "frame-00-at-7s.png"), "png"); process.exit(0); }
if (cmd === "--version") { console.log("0.8.133"); process.exit(0); }
process.exit(1);
`);
  write("ffprobe", `#!/usr/bin/env node
const a = process.argv.slice(2).join(" ");
if (a.includes("format=duration")) console.log("14.5");
else if (a.includes("stream=codec_name")) console.log(process.env.FAKE_AUDIO === "none" ? "" : "aac");
`);
  write("ffmpeg", `#!/usr/bin/env node
console.error("[Parsed_volumedetect_0] mean_volume: -18.2 dB");
`);
});

const NOW = "2026-10-12T10:00:00Z"; // 12:00 in the tenant's +02:00
const ENV = (extra = {}) => ({
  ...world.env,
  ZIGGY_POSTPROXY_BASE_URL: mock.baseUrl, POSTPROXY_API_KEY: API_KEY,
  ZIGGY_HYPERFRAMES_BIN: join(bins, "hyperframes"), ZIGGY_FFPROBE_BIN: join(bins, "ffprobe"), ZIGGY_FFMPEG_BIN: join(bins, "ffmpeg"),
  ...extra,
});
const FOUR = ["First fact.", "Second fact.", "Third fact.", "Fourth fact."];
const creates = () => mock.calls.filter((c) => c.method === "POST" && c.path === "/api/posts");
const pointsFile = (name, data) => { const f = join(world.root, `${name}.json`); writeFileSync(f, JSON.stringify(data)); return f; };

test("--plan: stories not covered and still before their deadline, oldest first, with title, dek and body", async () => {
  const r = await runCli(["round", "acme", "--plan", "--now", NOW, "--json"], ENV());
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.freshness, "next-day");
  assert.deepEqual(plan.stories.map((s) => s.prefix), [
    "harbour-reopens-after-the-storm",
    "concert-announced-for-tonight-downtown",
    "council-approves-the-school-budget",
    "night-market-draws-record-crowds",
  ], "the fair (the 9th) is past its deadline");
  assert.equal(plan.stories[0].deadline, "2026-10-12T21:59:00.000Z");
  assert.equal(plan.stories[0].dek, "The port authority lifted the ban this morning.");
  assert.equal(plan.stories.find((s) => s.prefix.startsWith("night")).image, false);
  // the article from the per-story endpoint, as plain text; "" where the feed has none (404)
  assert.equal(plan.stories[0].body, "The ban ended at 6:00, when the wind dropped under 20 knots.\n\nFerries to Linosa restart on Tuesday & the fish market reopens on Wednesday.");
  assert.deepEqual(plan.stories.slice(1).map((s) => s.body), ["", "", ""]);
  assert.deepEqual(Object.keys(plan.stories[0]), ["prefix", "date", "deadline", "section", "sources", "image", "title", "dek", "body"], "the plan is the same, plus body");
});

test("planRound: each story carries its body, fetched four at a time; a failed fetch is an empty body", async () => {
  const { planRound } = await import("../scripts/round.mjs");
  const { loadTenant } = await import("../scripts/config.mjs");
  const tenant = {
    ...loadTenant("acme"),
    feed: { url: "https://news.example/feed/v1/briefings?lang=it&limit=20", items: "data", fields: { date: "storyDate", image: "imageUrl" }, agent: null },
  };
  const feed = Array.from({ length: 6 }, (_, i) => ({ title: `Pier ${"ABCDEF"[i]} lights up`, dek: "The pier lights up.", storyDate: "2026-10-12T08:00:00Z", imageUrl: "https://news.example/p.jpg", slug: `pier-${i}-lights-up-0a1b2c3${i}` }));
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of the article adds one more fact.`).join(" ");
  const asked = [];
  let inFlight = 0, peak = 0;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === "/feed/v1/briefings") return new Response(JSON.stringify({ data: feed }), { status: 200 });
    asked.push(`${u.pathname}${u.search}`);
    assert.ok(init.signal instanceof AbortSignal, "every body fetch has a timeout");
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    const i = Number(u.pathname.split("/").pop().split("-")[1]);
    if (i === 4) return new Response("bad gateway", { status: 502 });
    if (i === 5) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ data: { bodyHtml: i === 0 ? `<p>${long}</p>` : `<p>Pier ${i} &amp; its <b>lights</b>.</p>` } }), { status: 200 });
  };
  const plan = await planRound(tenant, { fetchImpl, now: new Date(NOW), retryDelayMs: 0 });
  assert.deepEqual(plan.map((s) => s.prefix), feed.map((s) => s.slug));
  const detail = feed.map((s) => `/feed/v1/briefings/${s.slug}?lang=it`);
  assert.deepEqual(asked, [...detail, detail[5]], "the detail URL keeps only lang; the failed request is tried once more, the 502 is not");
  assert.equal(peak, 4);
  assert.ok(plan[0].body.length <= 1200 && plan[0].body.length > 1100, `${plan[0].body.length} characters`);
  assert.ok(long.startsWith(plan[0].body) && plan[0].body.endsWith("fact."), "cut at a sentence end");
  assert.deepEqual(plan.slice(1).map((s) => s.body), ["Pier 1 & its lights.", "Pier 2 & its lights.", "Pier 3 & its lights.", "", ""]);
});

test("--dry-run shows where each story would go, and writes, renders and posts nothing", async () => {
  const f = pointsFile("dry", { "council-approves": FOUR, "harbour-reopens": FOUR, skip: ["concert-announced"] });
  const r = await runCli(["round", "acme", "--points", f, "--dry-run", "--now", NOW, "--json"], ENV());
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  // nearest deadline first: yesterday's harbour story takes 13:00, the council 14:00 (55 minutes apart)
  assert.deepEqual(out.scheduled.map((s) => [s.name, s.at]), [
    ["story-2026-10-11-harbour-reopens-after-the", "2026-10-12T11:00:00.000Z"],
    ["story-2026-10-12-council-approves-the-school", "2026-10-12T12:00:00.000Z"],
  ]);
  assert.equal(creates().length, 0);
  assert.equal(existsSync(join(tenantDir("acme"), "campaigns", "story-2026-10-11-harbour-reopens-after-the")), false);
  assert.equal(existsSync(join(tenantDir("acme"), "campaigns", "story-2026-10-12-concert-announced-for-tonight")), false, "a dry run skips nothing for real");
});

test("a round: points → campaigns → renders → checks → scheduled; the rest is refused or skipped, and said", async () => {
  const r = await runCli(["round", "acme", "--points", "-", "--now", NOW, "--json"], ENV(), {
    input: JSON.stringify({ "council-approves": FOUR, "harbour-reopens": FOUR, "night-market": FOUR, "not-a-story": FOUR, skip: ["concert-announced"] }),
  });
  assert.equal(r.status, 1, "something needs a look: exit 1, with the summary still on stdout");
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.scheduled.map((s) => [s.name, s.at, s.posts.length]), [
    ["story-2026-10-11-harbour-reopens-after-the", "2026-10-12T11:00:00.000Z", 1],
    ["story-2026-10-12-council-approves-the-school", "2026-10-12T12:00:00.000Z", 1],
  ]);
  assert.deepEqual(creates().map((c) => c.fields["post[scheduled_at]"]), ["2026-10-12T11:00:00.000Z", "2026-10-12T12:00:00.000Z"]);
  assert.deepEqual(out.refused.map((x) => [x.prefix, x.reason]), [["night-market", "no photo in the feed"], ["not-a-story", "not in the feed"]]);
  assert.deepEqual(out.skipped.map((s) => s.name), ["story-2026-10-12-concert-announced-for-tonight"]);
  assert.ok(out.checks.every((c) => c.ok && c.audio === "aac" && c.meanDb === -18.2), JSON.stringify(out.checks));
  const campaign = JSON.parse(readFileSync(join(tenantDir("acme"), "campaigns", "story-2026-10-11-harbour-reopens-after-the", "campaign.json"), "utf8"));
  assert.deepEqual(campaign.copy.points, FOUR, "the reel has all four");
  // the caption: the first three, one "•" line each, under the dek
  assert.deepEqual(campaign.copy.captionPoints, FOUR.slice(0, 3));
  assert.ok(campaign.posts.instagram_reel.body.includes("The port authority lifted the ban this morning.\n\n• First fact.\n• Second fact.\n• Third fact.\n\nSourced from"), campaign.posts.instagram_reel.body);
  assert.equal(creates()[0].fields["post[body]"].replace(/\r\n/g, "\n"), campaign.posts.instagram_reel.body, "the caption that went out");
  assert.deepEqual(out.scheduled.map((s) => [s.points, s.captionPoints, s.dropped, s.rewritten]), [[4, 3, 0, false], [4, 3, 0, false]]);
  assert.equal(JSON.parse(readFileSync(join(tenantDir("acme"), "campaigns", "story-2026-10-12-concert-announced-for-tonight", "campaign.json"), "utf8")).skip, true);
  assert.match(out.text, /2 programmati su instagram_reel/);
  assert.match(out.text, /13:00 — harbour reopens after the · 4 punti$/m);
  assert.match(out.text, /Night market draws record crowds: no photo in the feed/);

  // the plan now holds only the story without a photo
  const plan = JSON.parse((await runCli(["round", "acme", "--plan", "--now", NOW, "--json"], ENV())).stdout);
  assert.deepEqual(plan.stories.map((s) => s.prefix), ["night-market-draws-record-crowds"]);
});

test("the same points again change nothing: covered stories are refused, never posted twice", async () => {
  const before = creates().length;
  const r = await runCli(["round", "acme", "--points", pointsFile("again", { "harbour-reopens": FOUR }), "--now", NOW, "--json"], ENV());
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).refused.map((x) => x.reason), ["already covered"]);
  assert.equal(creates().length, before);
});

test("a reel without sound fails the check and is not scheduled", async () => {
  items.push({ title: "Bridge works start on Monday", dek: "Traffic diverted for two weeks.", storyDate: "2026-10-12T09:00:00Z", sector: { name: "Cronaca" }, imageUrl: img("g"), slug: "bridge-works-start-on-monday", sourceCount: 2, languageCount: 1 });
  const before = creates().length;
  const r = await runCli(["round", "acme", "--points", pointsFile("mute", { "bridge-works": FOUR }), "--now", NOW, "--json"], ENV({ FAKE_AUDIO: "none" }));
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.checks.map((c) => [c.name, c.ok, c.problems]), [["story-2026-10-12-bridge-works-start-on", false, ["no audio"]]]);
  assert.equal(creates().length, before);
});

test("a story that cannot make its deadline is not scheduled past it", async () => {
  items.push({ title: "Late ferry delayed by fog", dek: "Two hours late.", storyDate: "2026-10-11T18:00:00Z", sector: { name: "Cronaca" }, imageUrl: img("h"), slug: "late-ferry-delayed-by-fog", sourceCount: 1, languageCount: 1 });
  // 23:30 local: the last time (23:00) is gone, and the deadline is tonight
  const r = await runCli(["round", "acme", "--points", pointsFile("late", { "late-ferry": FOUR }), "--now", "2026-10-12T21:30:00Z", "--json"], ENV());
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).scheduled.map((s) => s.error), ["no free time before its deadline"]);
});

test("a disconnected profile: nothing goes out, the summary says which, and --notify sends it", async () => {
  items.push({ title: "Library extends its opening hours", dek: "Open until ten on weekdays.", storyDate: "2026-10-12T09:30:00Z", sector: { name: "Cultura" }, imageUrl: img("i"), slug: "library-extends-its-opening-hours", sourceCount: 1, languageCount: 1 });
  const ig = mock.state.profiles.find((p) => p.platform === "instagram");
  ig.status = "inactive";
  try {
    const before = creates().length;
    const r = await runCli(["round", "acme", "--points", pointsFile("down", { "library-extends": FOUR }), "--now", NOW, "--notify", "--json"], ENV({
      TELEGRAM_BOT_TOKEN: "tg-token", TELEGRAM_CHAT_ID: "42", ZIGGY_TELEGRAM_BASE_URL: `http://127.0.0.1:${feedPort}`,
    }));
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.down, ["instagram_reel (inactive)"]);
    assert.deepEqual(out.scheduled.map((s) => s.error), ["no active platform"]);
    assert.equal(creates().length, before);
    assert.equal(telegram.length, 1);
    assert.equal(telegram[0].chat_id, "42");
    assert.match(telegram[0].text, /non pubblicati su instagram_reel \(inactive\): ricollega il profilo/);
  } finally {
    ig.status = "active";
  }
});

test("a tenant without daily.round cannot run a live round (it can still try one with --dry-run)", async () => {
  const tenantFile = join(tenantDir("acme"), "tenant.json");
  const saved = readFileSync(tenantFile, "utf8");
  const t = JSON.parse(saved);
  delete t.daily.round;
  writeFileSync(tenantFile, JSON.stringify(t));
  try {
    const f = pointsFile("optin", { "library-extends": FOUR });
    const live = await runCli(["round", "acme", "--points", f, "--now", NOW], ENV());
    assert.equal(live.status, 2);
    assert.match(live.stderr, /no daily\.round/);
    const dry = await runCli(["round", "acme", "--points", f, "--dry-run", "--now", NOW, "--json"], ENV());
    assert.equal(dry.status, 0, dry.stderr);
  } finally {
    writeFileSync(tenantFile, saved);
  }
});

test("bad input fails before anything is touched", async () => {
  const usage = await runCli(["round", "acme", "--now", NOW], ENV());
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: ziggy round/);
  const broken = await runCli(["round", "acme", "--points", "-", "--now", NOW], ENV(), { input: "{ not json" });
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /--points:/);
  const few = await runCli(["round", "acme", "--points", pointsFile("few", { "library-extends": ["Only one."] }), "--now", NOW, "--json"], ENV());
  assert.deepEqual(JSON.parse(few.stdout).refused.map((x) => x.reason), ["3–4 points expected"]);
});

test("casefile items are processed when tenant has casefile.enabled", async () => {
  const tenantFile = join(tenantDir("acme"), "tenant.json");
  const saved = readFileSync(tenantFile, "utf8");
  const t = JSON.parse(saved);
  Object.assign(t, WITH_CASEFILE);
  writeFileSync(tenantFile, JSON.stringify(t));
  
  try {
    const points = {
      "casefile": [
        {
          headline: "Test Case File",
          dek: "A sourced UAP fact for testing.",
          points: [
            "Confirmed: The records exist.",
            "Not confirmed: That Congress was denied the files.",
            "Why it matters: Videos are public, reports are not."
          ],
          source: {
            outlet: "Test Source",
            url: "https://example.com/test"
          }
        }
      ]
    };
    
    const f = pointsFile("with-casefile", points);
    const result = await runCli(["round", "acme", "--points", f, "--dry-run", "--now", NOW, "--json"], ENV());
    assert.equal(result.status, 0, result.stderr);
    
    const output = JSON.parse(result.stdout);
    assert.ok(output.casefiles, "should have casefiles array");
    assert.equal(output.casefiles.length, 1);
    assert.match(output.casefiles[0].title, /Test Case File/);
    assert.match(output.casefiles[0].name, /casefile-/);
  } finally {
    writeFileSync(tenantFile, saved);
  }
});

test("casefile items are validated before rendering", async () => {
  const tenantFile = join(tenantDir("acme"), "tenant.json");
  const saved = readFileSync(tenantFile, "utf8");
  const t = JSON.parse(saved);
  Object.assign(t, WITH_CASEFILE);
  writeFileSync(tenantFile, JSON.stringify(t));
  
  try {
    // Missing required field
    const invalidPoints = {
      casefile: [
        {
          headline: "Bad Case File",
          dek: "Missing points array.",
          source: { outlet: "Test" }
        }
      ]
    };
    
    const f = pointsFile("invalid-casefile", invalidPoints);
    const result = await runCli(["round", "acme", "--points", f, "--dry-run", "--now", NOW, "--json"], ENV());
    // Exit 1 because there's a refused item
    assert.equal(result.status, 1, result.stderr);
    
    const output = JSON.parse(result.stdout);
    assert.ok(output.refused.some(r => r.reason.includes("case file requires exactly 3 points")));
  } finally {
    writeFileSync(tenantFile, saved);
  }
});

test("interleaveNewsAndCasefiles alternates according to ratio", async () => {
  const { interleaveNewsAndCasefiles } = await import("../scripts/round.mjs");
  
  const newsItems = [
    { name: "news1", type: "news" },
    { name: "news2", type: "news" },
    { name: "news3", type: "news" },
  ];
  const casefileItems = [
    { name: "case1", type: "casefile" },
    { name: "case2", type: "casefile" },
  ];
  
  // Fill mode (default): news first, then case files
  const fillTenant = { casefile: { enabled: true } };
  const fillResult = interleaveNewsAndCasefiles(fillTenant, newsItems, casefileItems);
  assert.deepEqual(fillResult.map(i => i.name), ["news1", "news2", "news3", "case1", "case2"]);
  
  // Alternate mode 1:1
  const alternateTenant = { casefile: { enabled: true, mode: "alternate", ratio: { news: 1, casefile: 1 } } };
  const alternateResult = interleaveNewsAndCasefiles(alternateTenant, newsItems, casefileItems);
  assert.deepEqual(alternateResult.map(i => i.name), ["news1", "case1", "news2", "case2", "news3"]);
  
  // Alternate mode 2:1 (2 news for every 1 case file)
  const ratio2to1Tenant = { casefile: { enabled: true, mode: "alternate", ratio: { news: 2, casefile: 1 } } };
  const ratio2to1Result = interleaveNewsAndCasefiles(ratio2to1Tenant, newsItems, casefileItems);
  assert.deepEqual(ratio2to1Result.map(i => i.name), ["news1", "news2", "case1", "news3", "case2"]);
  
  // News is never dropped: more news than ratio allows
  const moreNews = [...newsItems, { name: "news4", type: "news" }, { name: "news5", type: "news" }];
  const allNewsResult = interleaveNewsAndCasefiles(alternateTenant, moreNews, casefileItems);
  assert.equal(allNewsResult.filter(i => i.name.startsWith("news")).length, 5, "all news items included");
  assert.equal(allNewsResult.filter(i => i.name.startsWith("case")).length, 2, "all case files included");
});

test("IANA timezone support with DST: Europe/Rome switches correctly", async () => {
  const { localAt, localDay } = await import("../scripts/round.mjs");
  
  // DST switch dates for 2026:
  // Spring forward: March 29, 2026 (02:00 -> 03:00, UTC+1 -> UTC+2)
  // Fall back: October 25, 2026 (03:00 -> 02:00, UTC+2 -> UTC+1)
  
  // Before spring DST (winter time, UTC+1)
  const winterDate = "2026-03-15"; // CET (UTC+1)
  const winter07 = localAt(winterDate, "07:00", "Europe/Rome");
  const winter07UTC = new Date(winter07).toISOString();
  assert.equal(winter07UTC, "2026-03-15T06:00:00.000Z", "07:00 CET = 06:00 UTC");
  
  // After spring DST (summer time, UTC+2)
  const summerDate = "2026-06-15"; // CEST (UTC+2)
  const summer07 = localAt(summerDate, "07:00", "Europe/Rome");
  const summer07UTC = new Date(summer07).toISOString();
  assert.equal(summer07UTC, "2026-06-15T05:00:00.000Z", "07:00 CEST = 05:00 UTC");
  
  // After fall DST (back to winter, UTC+1)
  const fallDate = "2026-11-15"; // CET (UTC+1)
  const fall07 = localAt(fallDate, "07:00", "Europe/Rome");
  const fall07UTC = new Date(fall07).toISOString();
  assert.equal(fall07UTC, "2026-11-15T06:00:00.000Z", "07:00 CET = 06:00 UTC");
  
  // LocalDay works correctly across DST
  assert.equal(localDay(winter07, "Europe/Rome"), winterDate);
  assert.equal(localDay(summer07, "Europe/Rome"), summerDate);
  assert.equal(localDay(fall07, "Europe/Rome"), fallDate);
});

test("Fixed offset timezones still work (backward compatibility)", async () => {
  const { localAt, localDay } = await import("../scripts/round.mjs");
  
  const date = "2026-06-15";
  
  // UTC
  const utc = localAt(date, "07:00", "Z");
  assert.equal(new Date(utc).toISOString(), "2026-06-15T07:00:00.000Z");
  
  // Fixed +02:00
  const plus2 = localAt(date, "07:00", "+02:00");
  assert.equal(new Date(plus2).toISOString(), "2026-06-15T05:00:00.000Z");
  
  // Fixed -05:00
  const minus5 = localAt(date, "07:00", "-05:00");
  assert.equal(new Date(minus5).toISOString(), "2026-06-15T12:00:00.000Z");
  
  // LocalDay with fixed offsets
  assert.equal(localDay(utc, "Z"), date);
  assert.equal(localDay(plus2, "+02:00"), date);
});

test("Deadline calculation respects DST with IANA timezones", async () => {
  const { storyDeadline } = await import("../scripts/round.mjs");
  
  // Story from winter (CET, UTC+1): deadline is 23:59 next day in CET
  const winterCfg = { tz: "Europe/Rome", freshness: "next-day" };
  const winterDeadline = storyDeadline(winterCfg, "2026-03-15");
  const winterDeadlineUTC = new Date(winterDeadline).toISOString();
  assert.equal(winterDeadlineUTC, "2026-03-16T22:59:00.000Z", "March 16 23:59 CET = March 16 22:59 UTC");
  
  // Story from summer (CEST, UTC+2): deadline is 23:59 next day in CEST
  const summerCfg = { tz: "Europe/Rome", freshness: "next-day" };
  const summerDeadline = storyDeadline(summerCfg, "2026-06-15");
  const summerDeadlineUTC = new Date(summerDeadline).toISOString();
  assert.equal(summerDeadlineUTC, "2026-06-16T21:59:00.000Z", "June 16 23:59 CEST = June 16 21:59 UTC");
});

test("casefile 'at' field is preserved through round execution", async () => {
  const { campaignsFromPoints, scheduleRound } = await import("../scripts/round.mjs");
  const { loadTenant } = await import("../scripts/config.mjs");
  
  const tenant = await loadTenant("acme");
  const tenantWithCasefile = { ...tenant, casefile: { enabled: true } };
  
  const points = {
    "casefile": [
      {
        "headline": "Test with specific time",
        "dek": "Should be scheduled at 14:00 UTC",
        "points": ["Confirmed point", "Not confirmed point", "Why it matters"],
        "source": { "outlet": "Test", "url": "https://example.com" },
        "at": "2026-10-14T14:00:00Z"
      }
    ]
  };
  
  const created = await campaignsFromPoints(tenantWithCasefile, points, { fetchImpl: fetch, now: new Date("2026-10-14T10:00:00Z"), write: false });
  
  assert.equal(created.casefiles.length, 1, "should create 1 casefile");
  assert.equal(created.casefiles[0].at, "2026-10-14T14:00:00Z", "casefile should have 'at' field from input");
  
  // Simulate the mapping that happens in runRound (this is where the bug was)
  const goodCasefiles = created.casefiles.map((m) => ({ 
    name: m.name, 
    campaign: m.campaign, 
    type: 'casefile', 
    at: m.at 
  }));
  
  assert.equal(goodCasefiles[0].at, "2026-10-14T14:00:00Z", "'at' field should be preserved in mapping");
  
  // Test scheduleRound respects the 'at' field  
  const { createClient } = await import("../scripts/postproxy.mjs");
  const client = createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });
  
  const scheduled = await scheduleRound(tenantWithCasefile, goodCasefiles, { 
    client, 
    now: new Date("2026-10-14T10:00:00Z"),
    dryRun: true 
  });
  
  assert.equal(scheduled.results.length, 1, "should schedule 1 item");
  assert.equal(scheduled.results[0].at, "2026-10-14T14:00:00.000Z", "should be scheduled at specified time, not next free slot");
  assert.ok(scheduled.results[0].dryRun, "should be marked as dry run");
});

test("a story or a case file whose caption repeats itself is refused before any render, and said", async () => {
  const { runRound } = await import("../scripts/round.mjs");
  const { loadTenant } = await import("../scripts/config.mjs");
  const { createClient } = await import("../scripts/postproxy.mjs");
  const tenant = { ...loadTenant("acme"), casefile: { enabled: true } };
  const feed = [
    { title: "Ferry service resumes to the island", dek: "The ferry service resumes to the island this week. Tickets go on sale today.", storyDate: "2026-10-12T06:00:00Z", sector: { name: "Cronaca" }, imageUrl: "https://acme.example/f.jpg", slug: "ferry-echo-1a2b3c4d", sourceCount: 2, languageCount: 1 },
    { title: "Library opens a new reading room", dek: "The room seats forty readers and opens on Monday.", storyDate: "2026-10-12T07:00:00Z", sector: { name: "Cultura" }, imageUrl: "https://acme.example/l.jpg", slug: "library-fresh-5e6f7a8b", sourceCount: 2, languageCount: 1 },
  ];
  const fetchImpl = async () => new Response(JSON.stringify({ data: feed }), { status: 200 });
  const good = {
    headline: "AARO found the records. It released none.",
    dek: "A FOIA reply tied to five cases was withheld in full as classified.",
    points: ["Confirmed: Confirmed: AARO located the records for five cases.", "Not confirmed: That Congress was denied them.", "Why it matters: The reports stay secret."],
    source: { outlet: "The Black Vault", url: "https://example.com/foia" },
    template: "casefile-dossier",
  };
  // the third point says the first one again
  const echo = { ...good, headline: "Five UAP case files stay classified", points: [good.points[0], good.points[1], "Why it matters: AARO located records for five cases."] };
  const out = await runRound(tenant, { "ferry-echo": FOUR, "library-fresh": FOUR, casefile: [echo, good] }, {
    fetchImpl, client: createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY }), now: new Date(NOW), dryRun: true,
  });
  assert.deepEqual(out.refused.map((r) => [r.prefix, r.title, r.reason]), [
    ["ferry-echo", "Ferry service resumes to the island", 'caption repeats itself: "Ferry service resumes to the island" ~ "The ferry service resumes to the island this week."'],
    ["Five UAP case files stay classified", "Five UAP case files stay classified", 'caption repeats itself: "AARO located the records for five cases." ~ "AARO located records for five cases."'],
  ]);
  assert.match(out.text, /✗ Ferry service resumes to the island: caption repeats itself: /);
  assert.match(out.text, /✗ Five UAP case files stay classified: caption repeats itself: /);
  assert.equal(out.ok, false);
  assert.deepEqual(out.checks.map((c) => c.name).sort(), [out.casefiles[0].name, "story-2026-10-12-library-fresh-5e6f7a8b"].sort(), "the repeating ones never reach the render");
  // the good case file goes through, with its label once
  assert.equal(out.casefiles.length, 1);
  const body = out.casefiles[0].campaign.posts.instagram_reel.body;
  assert.match(body, /✅ CONFIRMED: AARO located the records for five cases\./);
  assert.doesNotMatch(body, /CONFIRMED: Confirmed:/i);
  assert.equal(out.scheduled.filter((s) => s.dryRun).length, 2);
});

const LIBRARY = [{ title: "Library opens a new reading room", dek: "The room seats forty readers and opens on Monday.", storyDate: "2026-10-12T07:00:00Z", sector: { name: "Cultura" }, imageUrl: "https://acme.example/l.jpg", slug: "library-room-9a8b7c6d", sourceCount: 2, languageCount: 1 }];
const ECHO = ["The library opens a new reading room.", "The new room seats forty readers.", "The reading room opens on Monday.", "Forty readers fit in the new room."];
const FACTS = ["The council paid 40,000 euros from the 2026 budget.", "Opening hours run from 9:00 to 19:00, Saturdays included.", "Volunteers from the school will run a reading club on Fridays."];

test("points that repeat title, dek or each other leave the reel and the caption, never refuse the story; the new facts go in", async () => {
  const { campaignsFromPoints } = await import("../scripts/round.mjs");
  const { loadTenant } = await import("../scripts/config.mjs");
  const { campaignRepetition } = await import("../scripts/lint.mjs");
  const fetchImpl = async () => new Response(JSON.stringify({ data: LIBRARY }), { status: 200 });
  const run = (pts) => campaignsFromPoints(loadTenant("acme"), { "library-room": pts }, { fetchImpl, now: new Date(NOW), write: false });

  // no summary agent (feed.agent: null): nothing to rewrite them with, the story goes out without points
  const repeated = await run(ECHO);
  assert.deepEqual(repeated.refused, []);
  assert.deepEqual([repeated.made[0].points, repeated.made[0].captionPoints, repeated.made[0].dropped, repeated.made[0].rewritten], [0, 0, 4, false]);
  const c = repeated.made[0].campaign;
  assert.deepEqual(c.copy.points, [], "no slide retells title or dek");
  assert.deepEqual(c.copy.droppedPoints.map((d) => d.point), ECHO);
  assert.equal(c.duration, 13, "title and close only");
  assert.equal(c.posts.instagram_reel.body, `${LIBRARY[0].title}\n\n${LIBRARY[0].dek}\n\nSourced from 2 reports in 1 language.\n\nFull story with sources: https://acme.example/#/b/library-room-9a8b7c6d\n\n#UFO #UAP #Space #Astronomy`);

  const mixed = await run([ECHO[0], ...FACTS]);
  assert.deepEqual([mixed.made[0].points, mixed.made[0].captionPoints, mixed.made[0].dropped], [3, 3, 1]);
  assert.deepEqual(mixed.made[0].campaign.copy.points, FACTS, "the reel shows the same points as the caption");
  assert.deepEqual(mixed.made[0].campaign.copy.captionPoints, FACTS);
  assert.deepEqual(mixed.made[0].campaign.copy.droppedPoints, [{ point: ECHO[0], reason: "no new words" }]);
  assert.match(mixed.made[0].campaign.posts.instagram_reel.body, /on Monday\.\n\n• The council paid 40,000 euros/);
  assert.deepEqual(campaignRepetition(mixed.made[0].campaign), { ok: true, pairs: [] });
});

test("the operator's points through the lexical filter and the judge: the failing ones replaced from the article, up to 3 rounds; the round never fails on it", async () => {
  const { campaignsFromPoints, runRound } = await import("../scripts/round.mjs");
  const { loadTenant } = await import("../scripts/config.mjs");
  const { createClient } = await import("../scripts/postproxy.mjs");
  const tenant = { ...loadTenant("acme"), feed: { ...loadTenant("acme").feed, url: "https://news.example/feed/v1/briefings?lang=en&limit=20", agent: { command: ["fake-agent"] } } };
  const article = "<p>The council paid 40,000 euros from the 2026 budget.</p><p>Volunteers from the school will run a reading club on Fridays.</p>";
  const urls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    urls.push(u.pathname);
    if (u.pathname === "/feed/v1/briefings") return new Response(JSON.stringify({ data: LIBRARY }), { status: 200 });
    return new Response(JSON.stringify({ data: { bodyHtml: article } }), { status: 200 });
  };
  const run = (pts, spawnImpl, t = tenant, fetch = fetchImpl) => campaignsFromPoints(t, { "library-room": pts }, { fetchImpl: fetch, spawnImpl, now: new Date(NOW), write: false });
  // few shared words with the dek, the same information: the lexical filter keeps it, the judge does not
  const PARA = "Up to forty people can sit and read there.";
  const NEW4 = "A regional grant covered the new shelves and lamps.";
  const judge = { [PARA]: { vsDek: 0.85, newFact: "" } };

  // the operator's points only retell title and dek: no judge call while every point fails the
  // lexical filter; the agent replaces them from the article, and the new ones are judged
  const a = fakeStoryAgent({ judge, replace: FACTS.join("\n") });
  const good = await run(ECHO, a.spawnImpl);
  assert.deepEqual([a.prompts.judge.length, a.prompts.replace.length], [1, 1]);
  assert.deepEqual(urls.filter((p) => p !== "/feed/v1/briefings"), ["/feed/v1/briefings/library-room-9a8b7c6d"], "the body fetched once, for judge and rewrite");
  assert.match(a.prompts.replace[0], /^These are the points of a news story for the slides of a vertical reel and its caption, in order\. The ones marked ✗ were rejected, the ones marked ✓ are good:\n1\. ✗ The library opens a new reading room\. — says nothing the headline and deck do not\n/);
  for (const p of ECHO) assert.ok(a.prompts.replace[0].includes(`✗ ${p} — `), p);
  assert.match(a.prompts.replace[0], /Replace ONLY the ✗ points/);
  assert.match(a.prompts.replace[0], /CANNOT say/);
  assert.match(a.prompts.replace[0], /\nHeadline: Library opens a new reading room\nDeck: The room seats forty readers and opens on Monday\.\nArticle: The council paid 40,000 euros/);
  assert.match(a.prompts.judge[0], /\nPoints:\n0\. The council paid 40,000 euros/);
  const made = good.made[0];
  assert.deepEqual([made.points, made.captionPoints, made.dropped, made.rewritten, made.rounds], [3, 3, 1, true, 2]);
  assert.deepEqual(made.judge, { status: "on", threshold: 0.7, calls: 1, rewrites: 1, ms: made.judge.ms });
  assert.deepEqual(made.campaign.copy.points, FACTS);
  assert.deepEqual(made.campaign.copy.droppedPoints, [{ point: ECHO[3], reason: "dek" }], "the agent wrote three: the fourth is left out");
  assert.match(made.campaign.posts.instagram_reel.body, /\n\n• The council paid 40,000 euros from the 2026 budget\.\n• Opening hours/);

  // a paraphrase the lexical filter lets through: the judge fails it, the agent replaces only it
  const b = fakeStoryAgent({ judge, replace: [FACTS[0], FACTS[1], NEW4, FACTS[2]].join("\n") });
  const para = await run([FACTS[0], FACTS[1], PARA, FACTS[2]], b.spawnImpl);
  assert.deepEqual(para.made[0].campaign.copy.points, [FACTS[0], FACTS[1], NEW4, FACTS[2]]);
  assert.match(b.prompts.replace[0], /\n1\. ✓ The council paid[^\n]*\n2\. ✓ Opening hours[^\n]*\n3\. ✗ Up to forty people can sit and read there\. — repeats the deck \(0\.85\)\n4\. ✓ Volunteers/);
  assert.deepEqual([para.made[0].points, para.made[0].dropped, para.made[0].rounds, b.prompts.judge.length], [4, 0, 2, 2]);

  // every point adds a fact: one judge call, one round, no rewrite
  const c = fakeStoryAgent({ replace: () => assert.fail("nothing to replace") });
  const clean = await run([...FACTS, NEW4], c.spawnImpl);
  assert.deepEqual([clean.made[0].points, clean.made[0].rounds, clean.made[0].rewritten, c.prompts.all.length], [4, 1, false, 1]);

  // a failing agent: the judge fails → the lexical filter alone, the story still goes out
  for (const reply of [{ status: 1, stdout: "", stderr: "boom" }, { error: Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }) }]) {
    const broken = fakeStoryAgent({ judge: () => reply, replace: reply });
    const out = await run([ECHO[0], FACTS[0], PARA, FACTS[1]], broken.spawnImpl);
    assert.deepEqual(out.refused, []);
    assert.deepEqual([out.made[0].campaign.copy.points, out.made[0].rewritten, out.made[0].judge.status], [[FACTS[0], PARA, FACTS[1]], false, "failed"]);
  }
  // no agent: the lexical filter alone, nothing asked
  const none = await run(ECHO, () => assert.fail("feed.agent: null"), { ...tenant, feed: { ...tenant.feed, agent: null } });
  assert.deepEqual([none.made[0].points, none.made[0].rewritten, none.made[0].rounds, none.made[0].judge.status], [0, false, 1, "off"]);

  // no article: judged and dropped, never rewritten (new facts come only from the article)
  const noBody = async (url) => (new URL(url).pathname === "/feed/v1/briefings" ? new Response(JSON.stringify({ data: LIBRARY }), { status: 200 }) : new Response("nope", { status: 404 }));
  const d = fakeStoryAgent({ judge, replace: () => assert.fail("no body, no rewrite") });
  const bare = await run([FACTS[0], FACTS[1], PARA, FACTS[2]], d.spawnImpl, tenant, noBody);
  assert.deepEqual(bare.made[0].campaign.copy.droppedPoints, [{ point: PARA, reason: "semantic 0.85 vs dek" }]);
  assert.deepEqual([bare.made[0].points, bare.made[0].rounds, d.prompts.replace.length], [3, 1, 0]);

  // the round's summary line: kept points, dropped ones, and the rounds when more than one
  const client = createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });
  const round = await runRound(tenant, { "library-room": ECHO }, { fetchImpl, spawnImpl: fakeStoryAgent({ judge, replace: FACTS.join("\n") }).spawnImpl, client, now: new Date(NOW), dryRun: true });
  assert.match(round.text, /— library room 9a8b7c6d · 3 punti \(1 scartato, 2 giri\)$/m);
  assert.deepEqual(round.scheduled.map((s) => [s.points, s.captionPoints, s.dropped, s.rewritten, s.rounds, s.judge.status, s.judge.calls, s.judge.rewrites]), [[3, 3, 1, true, 2, "on", 1, 1]]);
  const replaced = await runRound(tenant, { "library-room": [FACTS[0], FACTS[1], PARA, FACTS[2]] }, { fetchImpl, spawnImpl: fakeStoryAgent({ judge, replace: [FACTS[0], FACTS[1], NEW4, FACTS[2]].join("\n") }).spawnImpl, client, now: new Date(NOW), dryRun: true });
  assert.match(replaced.text, /— library room 9a8b7c6d · 4 punti \(2 giri\)$/m);
  const thin = await runRound({ ...tenant, feed: { ...tenant.feed, agent: null } }, { "library-room": [ECHO[0], ECHO[1], ECHO[2], FACTS[0]] }, { fetchImpl, client, now: new Date(NOW), dryRun: true });
  assert.match(thin.text, /— library room 9a8b7c6d · 1 punto \(3 scartati\)$/m);
  const empty = await runRound({ ...tenant, feed: { ...tenant.feed, agent: null } }, { "library-room": ECHO }, { fetchImpl, client, now: new Date(NOW), dryRun: true });
  assert.match(empty.text, /— library room 9a8b7c6d · nessun punto \(4 scartati\)$/m);
});

test("a round judges the stories' points three at a time, and keeps the points file's order", async () => {
  const { campaignsFromPoints } = await import("../scripts/round.mjs");
  const { loadTenant } = await import("../scripts/config.mjs");
  const tenant = { ...loadTenant("acme"), feed: { ...loadTenant("acme").feed, url: "https://news.example/feed/v1/briefings?lang=en&limit=20", agent: { command: ["fake-agent"] } } };
  const feed = Array.from({ length: 5 }, (_, i) => ({ ...LIBRARY[0], title: `Pier ${"ABCDE"[i]} lights up`, dek: "The pier lights up at dusk.", slug: `pier-${i}-lights-0a1b2c3${i}` }));
  const fetchImpl = async (url) => new Response(JSON.stringify(new URL(url).pathname === "/feed/v1/briefings" ? { data: feed } : { data: { bodyHtml: "<p>Body.</p>" } }), { status: 200 });
  const { spawnImpl: judgeNow } = fakeStoryAgent();
  let inFlight = 0, peak = 0;
  const spawnImpl = async (...args) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return judgeNow(...args);
  };
  const first = (i) => `The council spent ${i + 1}0,000 euros on the lamps.`;
  const points = Object.fromEntries(feed.map((s, i) => [s.slug, [first(i), "Workers from Ragusa installed them overnight.", "They switch on daily at 18:30."]]));
  const out = await campaignsFromPoints(tenant, points, { fetchImpl, spawnImpl, now: new Date(NOW), write: false });
  assert.equal(peak, 3);
  assert.deepEqual(out.made.map((m) => m.campaign.story.slug), feed.map((s) => s.slug));
  assert.deepEqual(out.made.map((m) => [m.campaign.copy.points[0], m.points, m.rounds]), feed.map((_, i) => [first(i), 3, 1]));
});
