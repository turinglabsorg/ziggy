import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { renderBed } from "../scripts/bed.mjs";
import { DEFAULT_VARIANTS, resolveVariants, scaffold, starField } from "../scripts/video.mjs";
import { buildHeaderProject, buildProfileProject, monogram } from "../scripts/assets.mjs";
import { makeWorld } from "./helpers.mjs";

const CLI = join(import.meta.dirname, "..", "index.js");
const world = makeWorld({ withRenders: false });
after(world.cleanup);

process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;
const { loadTenant, loadCampaign, fontsDir } = await import("../scripts/config.mjs");

// a stand-in woff2 so @font-face lines are generated without network
mkdirSync(fontsDir("acme"), { recursive: true });
for (const f of ["Unbounded", "Geist", "GeistMono"]) writeFileSync(join(fontsDir("acme"), `${f}.woff2`), Buffer.alloc(64, 0));

test("the bed is deterministic and a valid 16-bit stereo WAV of the requested length", () => {
  const a = renderBed({ seconds: 1.0 }), b = renderBed({ seconds: 1.0 });
  assert.equal(a.equals(b), true);
  assert.equal(a.toString("ascii", 0, 4), "RIFF");
  assert.equal(a.readUInt16LE(22), 2);
  assert.equal(a.readUInt32LE(24), 48000);
  assert.equal(a.length, 44 + 48000 * 4);
  assert.notEqual(renderBed({ seconds: 1.0, seed: 7 }).equals(a), true);
});

test("star fields are seeded and keep the centre band sparse", () => {
  const s1 = starField(40, 1080, 1920, 99), s2 = starField(40, 1080, 1920, 99);
  assert.deepEqual(s1, s2);
  const centre = s1.filter((s) => s.x > 324 && s.x < 756 && s.y > 634 && s.y < 1286);
  assert.ok(centre.length < s1.length / 3);
});

test("variants merge campaign overrides onto defaults and reject unknown names", () => {
  const v = resolveVariants({ variants: { reel: { mark: 160 }, square: { w: 1080, h: 1080, layout: "stacked", mark: 140, teaser: 44, tag: 36, tagMax: 760, url: 30, orbitK: 0.78, stars: 30, pad: 100 } } });
  assert.equal(v.reel.mark, 160);
  assert.equal(v.reel.h, DEFAULT_VARIANTS.reel.h);
  assert.equal(v.square.w, 1080);
  assert.throws(() => resolveVariants({}, ["nope"]), /unknown variant/);
  assert.deepEqual(Object.keys(resolveVariants({}, ["x"])), ["x"]);
});

test("scaffold writes complete HyperFrames projects from brand + campaign", async () => {
  const tenant = loadTenant("acme"), campaign = loadCampaign("acme", "launch");
  const out = join(world.root, "videos");
  const projects = await scaffold({ tenant, campaign, variants: resolveVariants(campaign), outRoot: out });
  assert.equal(projects.length, 3);
  for (const p of projects) {
    for (const f of ["index.html", `compositions/${p.id}.html`, "hyperframes.json", "package.json", "meta.json", "BRIEF.md", "assets/bed.wav", "assets/fonts/Unbounded.woff2"]) {
      assert.ok(existsSync(join(p.dir, f)), `${p.variant}: ${f}`);
    }
    const sub = readFileSync(join(p.dir, `compositions/${p.id}.html`), "utf8");
    assert.match(sub, new RegExp(`data-composition-id="${p.id}"`));
    assert.match(sub, /--accent: #ff5a1f;/);
    assert.match(sub, /Someone is keeping watch\./);
    assert.match(sub, /ACME.?CORP|Acme/i);
    assert.match(sub, /<span class="ch">A<\/span>/);
    assert.match(sub, /id="[\w-]+-w-last"/, "the last wordmark part anchors the accent dot");
    assert.match(sub, /@font-face \{ font-family: "Unbounded"/);
    assert.match(sub, /<audio id="[\w-]+-bed" src="assets\/bed.wav"/);
    const host = readFileSync(join(p.dir, "index.html"), "utf8");
    assert.match(host, new RegExp(`data-composition-src="compositions/${p.id}.html"`));
    assert.match(host, new RegExp(`data-width="${p.w}" data-height="${p.h}"`));
    assert.match(readFileSync(join(p.dir, "package.json"), "utf8"), /hyperframes@0\.8\.133 check/);
  }
  const x = readFileSync(join(projects.find((p) => p.variant === "x").dir, "compositions/teaser-x.html"), "utf8");
  assert.match(x, /flex-direction: row/);
  const reel = readFileSync(join(projects.find((p) => p.variant === "reel").dir, "compositions/teaser-reel.html"), "utf8");
  assert.match(reel, /flex-direction: column/);
});

test("no audio when the campaign says so; HTML in copy is escaped", async () => {
  const tenant = loadTenant("acme"), campaign = { ...loadCampaign("acme", "launch"), audio: null, copy: { teaser: "<b>x</b> & y", url: "acme.example" } };
  const [p] = await scaffold({ tenant, campaign, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "videos2") });
  const sub = readFileSync(join(p.dir, "compositions/teaser-reel.html"), "utf8");
  assert.doesNotMatch(sub, /<audio/);
  assert.ok(!existsSync(join(p.dir, "assets/bed.wav")));
  assert.match(sub, /&lt;b&gt;x&lt;\/b&gt; &amp; y/);
});

test("identity assets: profile from the favicon SVG, header from the wordmark; monogram fallback", () => {
  const tenant = loadTenant("acme");
  const brand = { ...tenant.brand, slug: "acme" };
  const pdir = buildProfileProject(brand, join(world.root, "assets", "profile"));
  const html = readFileSync(join(pdir, "index.html"), "utf8");
  assert.match(html, /<svg preserveAspectRatio="xMidYMid meet"/);
  assert.match(html, /data-width="1000" data-height="1000"/);
  const hdir = buildHeaderProject(brand, join(world.root, "assets", "header"));
  const h = readFileSync(join(hdir, "index.html"), "utf8");
  assert.match(h, /data-width="3000" data-height="1000"/);
  assert.match(h, /<span class="part" style="font-weight: 300">Acme<\/span><span class="part" style="font-weight: 600">Corp<\/span><span class="dot"><\/span>/);
  assert.match(h, /Things, observed\./);
  assert.equal(monogram({ wordmark: { parts: [{ text: "Alien" }, { text: "Watch" }] } }), "AW");
  const noMark = buildProfileProject({ ...brand, mark: null }, join(world.root, "assets", "profile2"));
  assert.match(readFileSync(join(noMark, "index.html"), "utf8"), /id="monogram">AC</);
});

test("ziggy video drives check/render/snapshot through the HyperFrames CLI (faked here)", () => {
  const fake = join(world.root, "fakehf");
  mkdirSync(fake, { recursive: true });
  const bin = join(fake, "hyperframes");
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const [cmd, ...rest] = process.argv.slice(2);
fs.appendFileSync(path.join(${JSON.stringify(fake)}, "calls.log"), process.cwd() + " " + process.argv.slice(2).join(" ") + "\\n");
if (cmd === "check") { console.log("◇  Check passed"); process.exit(0); }
if (cmd === "render") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, "mp4"); console.log("◇  " + o); process.exit(0); }
if (cmd === "snapshot") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(o, { recursive: true }); fs.writeFileSync(path.join(o, "frame-00-at-7.45s.png"), "png"); process.exit(0); }
if (cmd === "--version") { console.log("0.8.133"); process.exit(0); }
process.exit(1);
`);
  chmodSync(bin, 0o755);
  const r = spawnSync(process.execPath, [CLI, "video", "acme", "launch", "--json"], { encoding: "utf8", env: { ...world.env, ZIGGY_HYPERFRAMES_BIN: bin } });
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(manifest.outputs).sort(), ["post", "reel", "x"]);
  for (const o of Object.values(manifest.outputs)) { assert.ok(existsSync(o.video)); assert.ok(existsSync(o.still)); }
  const log = readFileSync(join(fake, "calls.log"), "utf8");
  assert.equal((log.match(/ check$/gm) || []).length, 3);
  assert.equal((log.match(/ render \. --skill=motion-graphics -q high -o /gm) || []).length, 3);
  assert.ok(existsSync(join(world.home, "tenants", "acme", "renders", "launch", "manifest.json")));
  const only = spawnSync(process.execPath, [CLI, "video", "acme", "launch", "--variants", "x", "--json"], { encoding: "utf8", env: { ...world.env, ZIGGY_HYPERFRAMES_BIN: bin } });
  assert.deepEqual(Object.keys(JSON.parse(only.stdout).outputs), ["x"]);
});
