import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { pointProblems, roundConfig, storyDeadline } from "../scripts/round.mjs";
import { API_KEY, makeWorld, runCli, startMockPostproxy } from "./helpers.mjs";

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
    { title: "Harbour reopens after the storm", dek: "The port authority lifted the ban this morning.", storyDate: "2026-10-11T09:00:00Z", sector: { name: "Cronaca" }, imageUrl: img("a"), slug: "harbour-reopens-after-the-storm", sourceCount: 3, languageCount: 1 },
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
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: items.map((it) => ({ ...it, imageUrl: it.imageUrl && it.imageUrl.replace("__FEED__", `http://127.0.0.1:${feedPort}`) })) }));
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

test("--plan: stories not covered and still before their deadline, oldest first, with title and dek", async () => {
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
  assert.deepEqual(campaign.copy.points, FOUR);
  assert.equal(JSON.parse(readFileSync(join(tenantDir("acme"), "campaigns", "story-2026-10-12-concert-announced-for-tonight", "campaign.json"), "utf8")).skip, true);
  assert.match(out.text, /2 programmati su instagram_reel/);
  assert.match(out.text, /13:00 — harbour reopens after the/);
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
