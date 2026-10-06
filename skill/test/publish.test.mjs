import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { API_KEY, fakeHush, makeWorld, runCli, startMockPostproxy } from "./helpers.mjs";

const CLI = join(import.meta.dirname, "..", "index.js");
const world = makeWorld();
let mock;
before(async () => { mock = await startMockPostproxy(); });
after(async () => { await mock.close(); world.cleanup(); });

const run = (args, extraEnv = {}) => runCli(args, { ...world.env, ZIGGY_POSTPROXY_BASE_URL: mock.baseUrl, POSTPROXY_API_KEY: API_KEY, ...extraEnv });

test("post → drafts: one Postproxy post per campaign entry, right media, right platform params", async () => {
  const r = await run(["post", "acme", "launch", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.map((x) => x.kind), ["twitter", "instagram_reel", "instagram_post"]);
  assert.ok(out.every((x) => x.post.status === "draft"));
  const creates = mock.calls.filter((c) => c.method === "POST" && c.path === "/api/posts");
  assert.equal(creates.length, 3);
  const reel = creates[1].fields;
  assert.equal(reel["platforms[instagram][format]"], "reel");
  assert.equal(reel["platforms[instagram][first_comment]"], "More at acme.example");
  assert.match(reel["media[]"][0].filename, /reel-1080x1920\.mp4$/);
  assert.match(reel["platforms[instagram][cover_file]"].filename, /reel-1080x1920\.png$/);
  const still = creates[2].fields;
  assert.match(still["media[]"][0].filename, /post-1080x1350\.png$/);
  assert.equal(still["platforms[instagram][alt_text]"], "Acme wordmark");
  const log = readFileSync(join(world.home, "tenants", "acme", "posts.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(log.length, 3);
  assert.equal(log[0].campaign, "launch");
});

test("publish <ids> publishes the drafts and reports permalinks", async () => {
  const ids = Object.keys(mock.state.posts);
  const r = await run(["publish", "acme", ...ids, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.every((x) => x.permalinks.every((p) => p.status === "published" && p.url)));
});

test("--live creates and publishes in one go; --only limits the kinds; --dry-run sends nothing", async () => {
  const before = mock.calls.length;
  let r = await run(["post", "acme", "launch", "--dry-run", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(mock.calls.length - before, 1, "dry run only lists profiles");
  r = await run(["post", "acme", "launch", "--live", "--only", "twitter", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "twitter");
  assert.equal(out[0].post.status, "processed");
  assert.equal(mock.calls.at(-1).fields["post[draft]"], undefined);
});

test("validation stops the whole campaign before any upload", async () => {
  const long = "x".repeat(300);
  const campaign = join(world.repo, "tenants", "acme", "campaigns", "launch", "campaign.json");
  const c = JSON.parse(readFileSync(campaign, "utf8"));
  const saved = c.posts.twitter.body;
  c.posts.twitter.body = long;
  writeFileSync(campaign, JSON.stringify(c));
  const before = mock.calls.filter((x) => x.method === "POST").length;
  const r = await run(["post", "acme", "launch"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /twitter: body is 300 chars, limit 280/);
  assert.equal(mock.calls.filter((x) => x.method === "POST").length, before, "nothing was created");
  c.posts.twitter.body = saved;
  writeFileSync(campaign, JSON.stringify(c));
});

test("without POSTPROXY_API_KEY the command re-executes itself under hush and the key reaches only the child", async () => {
  const hushDir = join(world.root, "fakebin");
  fakeHush(hushDir, { names: ["ziggy.acme.postproxy"], secretValue: API_KEY });
  const env = { ...world.env, ZIGGY_POSTPROXY_BASE_URL: mock.baseUrl, ZIGGY_HUSH_BIN: join(hushDir, "hush") };
  delete env.POSTPROXY_API_KEY;
  const r = await runCli(["profiles", "acme", "--json"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).length, 2);
  assert.equal(r.stdout.includes(API_KEY), false);
  const s = await runCli(["keys", "status", "acme", "--json"], env);
  const status = JSON.parse(s.stdout);
  assert.equal(status.hushStored, true);
  assert.equal(status.secretName, "ziggy.acme.postproxy");
});

test("keys pull wraps hush pull with the tenant's secret name", async () => {
  const hushDir = join(world.root, "fakebin2");
  fakeHush(hushDir, { names: [] });
  const r = spawnSync(process.execPath, [CLI, "keys", "pull", "acme", "--send", "https://send.bitwarden.com/#abc/def"], { encoding: "utf8", env: { ...world.env, ZIGGY_HUSH_BIN: join(hushDir, "hush") } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { event: "stored", name: "ziggy.acme.postproxy", sender: "self", replaced: false });
});

test("post → tiktok kind: reel media, format=video and the tiktok platform params on the wire", async () => {
  const campaign = join(world.repo, "tenants", "acme", "campaigns", "launch", "campaign.json");
  const c = JSON.parse(readFileSync(campaign, "utf8"));
  c.posts.tiktok = { body: "Acme is live.", media: "reel", platform: { privacy_status: "PUBLIC_TO_EVERYONE", disable_comment: false, disable_duet: true, disable_stitch: true } };
  writeFileSync(campaign, JSON.stringify(c));
  mock.state.profiles.push({ id: "prof_tt", name: "Brand", platform: "tiktok", status: "active", profile_group_id: "grp_1" });
  const r = await run(["post", "acme", "launch", "--only", "tiktok", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const create = mock.calls.filter((x) => x.method === "POST" && x.path === "/api/posts").at(-1).fields;
  assert.equal(create["platforms[tiktok][format]"], "video");
  assert.equal(create["platforms[tiktok][privacy_status]"], "PUBLIC_TO_EVERYONE");
  assert.equal(create["platforms[tiktok][disable_comment]"], "false");
  assert.equal(create["platforms[tiktok][disable_duet]"], "true");
  assert.match(create["media[]"][0].filename, /reel-1080x1920\.mp4$/);
  const log = readFileSync(join(world.home, "tenants", "acme", "posts.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(log.at(-1).kind, "tiktok");
  assert.equal(log.at(-1).platform, "tiktok");
});

test("tiktok requires media and rejects images on a video post", async () => {
  const campaign = join(world.repo, "tenants", "acme", "campaigns", "launch", "campaign.json");
  const c = JSON.parse(readFileSync(campaign, "utf8"));
  c.posts.tiktok = { body: "Acme is live." };
  writeFileSync(campaign, JSON.stringify(c));
  let r = await run(["post", "acme", "launch", "--only", "tiktok"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /tiktok: tiktok requires media/);
  c.posts.tiktok = { body: "Acme is live.", media: "post-still" };
  writeFileSync(campaign, JSON.stringify(c));
  r = await run(["post", "acme", "launch", "--only", "tiktok"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /tiktok: a TikTok video post cannot take images/);
});

test("status lists the tenant's own posts from its log", async () => {
  const r = await run(["status", "acme", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.length >= 3);
  assert.ok(existsSync(join(world.home, "tenants", "acme", "posts.jsonl")));
});
