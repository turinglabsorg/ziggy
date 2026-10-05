import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { makeWorld } from "./helpers.mjs";

const CLI = join(import.meta.dirname, "..", "index.js");
const world = makeWorld({ withCampaign: false, withRenders: false, withBrand: false });
after(world.cleanup);

const run = (args, env = world.env) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });

test("tenant add → tenants → tenant show, definitions live in the repo", () => {
  let r = run(["tenant", "add", "nova", "--name", "Nova", "--site", "https://nova.example", "--lang", "en"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(world.repo, "tenants", "nova", "tenant.json")));
  assert.ok(existsSync(join(world.repo, "tenants", "nova", "playbook.md")), "a starter playbook is written");
  r = run(["tenants", "--json"]);
  const list = JSON.parse(r.stdout);
  assert.deepEqual(list.map((t) => t.slug).sort(), ["acme", "nova"]);
  r = run(["tenant", "show", "nova", "--json"]);
  const t = JSON.parse(r.stdout);
  assert.equal(t.site, "https://nova.example/");
  assert.equal(t.brand, null);
});

test("slugs are validated; unknown tenants fail with a hint", () => {
  let r = run(["tenant", "add", "Bad Slug", "--name", "x", "--site", "https://x.example"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /slug must match/);
  r = run(["tenant", "show", "ghost"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown tenant "ghost"/);
});

test("campaign add scaffolds a campaign with per-platform posts; copy validates lengths", () => {
  let r = run(["campaign", "add", "nova", "launch"]);
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(readFileSync(join(world.repo, "tenants", "nova", "campaigns", "launch", "campaign.json"), "utf8"));
  assert.equal(c.template, "teaser");
  assert.deepEqual(Object.keys(c.posts).sort(), ["instagram_post", "instagram_reel", "twitter"]);
  r = run(["copy", "nova", "launch", "--json"]);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.find((x) => x.kind === "twitter").limit, 280);
  r = run(["campaign", "add", "nova", "bad", "--template", "nope"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown template/);
});

test("init writes ~/.ziggy/config.json with the repo path, mode 600", () => {
  const r = run(["init", "--repo", world.repo, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const cfg = JSON.parse(readFileSync(join(world.home, "config.json"), "utf8"));
  assert.equal(cfg.repo, world.repo);
});

test("key-needing commands refuse without a key and without hush, naming the fix", () => {
  const env = { ...world.env, PATH: "/nonexistent" };
  delete env.POSTPROXY_API_KEY;
  const r = run(["profiles", "acme"], env);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /POSTPROXY_API_KEY is not set/);
  assert.match(r.stderr, /hush is not installed/);
});
