import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { makeWorld } from "./helpers.mjs";
import { composeThread, splitText } from "../scripts/thread.mjs";
import { buildRequest, validatePost } from "../scripts/publish.mjs";
import { buildSlideProject, slideSpecs } from "../scripts/slides.mjs";
import { loadTenant } from "../scripts/config.mjs";

const CLI = join(import.meta.dirname, "..", "index.js");
const world = makeWorld();
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;

test("a thread splits on sentences, keeps every part inside the limit, and parks the URL last", () => {
  assert.deepEqual(splitText("Short.", 280), ["Short."]);
  const long = "Alpha sentence here. Beta sentence follows it. Gamma closes the thought.";
  const parts = splitText(long, 40);
  assert.ok(parts.every((p) => p.length <= 40));
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long);
  const thread = composeThread({
    title: "Laboratory experiments suggest Enceladus could host microbes",
    dek: long,
    url: "https://alienwatch.buzz/story",
    limit: 40,
  });
  const all = [thread.body, ...thread.thread.map((t) => t.body)];
  assert.ok(all.every((p) => p.length <= 40));
  assert.equal(all.at(-1), "https://alienwatch.buzz/story");
  assert.equal(thread.body.includes("http"), false);
  assert.equal(all[0], "Laboratory experiments suggest Enceladus");
});

test("an Instagram post with several stills uploads every image", () => {
  const dir = join(world.root, "media");
  mkdirSync(dir, { recursive: true });
  const files = ["slide-cover", "slide-dek", "slide-close"].map((id) => {
    const file = join(dir, `${id}.png`);
    writeFileSync(file, Buffer.alloc(800, 4));
    return file;
  });
  const manifest = { outputs: { "slide-cover": { still: files[0] }, "slide-dek": { still: files[1] }, "slide-close": { still: files[2] } } };
  const built = buildRequest("instagram_post", {
    body: "caption",
    media: ["slide-cover", "slide-dek", "slide-close"],
    alt_text: ["a", "b", "c"],
    first_comment: "Comment LINK",
  }, { profile: { id: "prof_ig" }, manifest, draft: true });
  assert.deepEqual(built.problems, []);
  assert.deepEqual(built.request.media, files);
  assert.equal(built.request.platforms.instagram.format, "post");
  assert.deepEqual(built.request.platforms.instagram.alt_text, ["a", "b", "c"]);
  const tooMany = validatePost("instagram_post", { body: "x" }, Array.from({ length: 11 }, () => files[0]));
  assert.match(tooMany.join(" "), /11 images/);
});

test("slide projects are static cards: cover keeps the photo, the dek card does not", async () => {
  const tenant = loadTenant("acme");
  const campaign = {
    name: "story", language: "en", dir: world.root, image: join(world.root, "hero.jpg"),
    copy: { kicker: "Science · 3 Oct", headline: "Hidden ocean", dek: "Archaea may survive there.", meta: "2 sources", url: "acme.example" },
  };
  writeFileSync(campaign.image, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const specs = slideSpecs(campaign);
  assert.deepEqual(specs.map((s) => s.id), ["slide-cover", "slide-dek", "slide-close"]);
  const cover = await buildSlideProject(tenant, campaign, specs[0], join(world.root, "cover"));
  const coverHtml = readFileSync(join(cover, "index.html"), "utf8");
  assert.match(coverHtml, /Hidden ocean/);
  assert.match(coverHtml, /assets\/story\.jpg/);
  assert.match(coverHtml, /data-width="1080" data-height="1350"/);
  assert.match(coverHtml, /window\.__timelines\["slide"\]/);
  const dek = await buildSlideProject(tenant, campaign, specs[1], join(world.root, "dek"));
  const dekHtml = readFileSync(join(dek, "index.html"), "utf8");
  assert.match(dekHtml, /Archaea may survive there\./);
  assert.match(dekHtml, /class="layout-text"/);
  assert.match(dekHtml, /layout-text #photo \{ display: none/);
  const close = await buildSlideProject(tenant, campaign, specs[2], join(world.root, "close"));
  assert.match(readFileSync(join(close, "index.html"), "utf8"), /Comment LINK/);
});

test("ziggy thread rewrites the campaign and ziggy slides captures three stills", () => {
  const fonts = join(world.home, "tenants", "acme", "brand", "fonts");
  mkdirSync(fonts, { recursive: true });
  writeFileSync(join(fonts, "Unbounded.woff2"), "woff");
  const campDir = join(world.repo, "tenants", "acme", "campaigns", "story");
  mkdirSync(campDir, { recursive: true });
  writeFileSync(join(campDir, "campaign.json"), JSON.stringify({
    template: "story", language: "en",
    story: { url: "https://acme.example/story" },
    copy: { kicker: "Science", headline: "A short headline", dek: "One sentence of the dek.", meta: "1 source", url: "acme.example" },
    posts: { twitter: { body: "old", media: "reel", enabled: false }, instagram_reel: { body: "reel", media: "reel" } },
  }));
  const thread = spawnSync(process.execPath, [CLI, "thread", "acme", "story", "--json"], { encoding: "utf8", env: world.env });
  assert.equal(thread.status, 0, thread.stderr);
  const written = JSON.parse(readFileSync(join(campDir, "campaign.json"), "utf8"));
  assert.equal(written.posts.twitter.body, "A short headline");
  assert.equal(written.posts.twitter.thread.at(-1).body, "https://acme.example/story");
  assert.equal(written.posts.twitter.media, "slide-cover");
  assert.equal(written.posts.twitter.enabled, false);

  const fake = join(world.root, "fakehf2");
  mkdirSync(fake, { recursive: true });
  const bin = join(fake, "hyperframes");
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "check") { console.log("◇  Check passed"); process.exit(0); }
if (cmd === "snapshot") { const o = rest[rest.indexOf("-o") + 1]; fs.mkdirSync(o, { recursive: true }); fs.writeFileSync(path.join(o, "frame-00-at-0.50s.png"), "png"); process.exit(0); }
process.exit(1);
`);
  chmodSync(bin, 0o755);
  const slides = spawnSync(process.execPath, [CLI, "slides", "acme", "story", "--json"], { encoding: "utf8", env: { ...world.env, ZIGGY_HYPERFRAMES_BIN: bin } });
  assert.equal(slides.status, 0, slides.stderr);
  const manifest = JSON.parse(slides.stdout);
  for (const id of ["slide-cover", "slide-dek", "slide-close"]) assert.ok(existsSync(manifest.outputs[id].still), id);
  const after = JSON.parse(readFileSync(join(campDir, "campaign.json"), "utf8"));
  assert.deepEqual(after.posts.instagram_post.media, ["slide-cover", "slide-dek", "slide-close"]);
  assert.equal(after.posts.instagram_post.enabled, undefined);
});
