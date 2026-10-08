import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { wav } from "../scripts/bed.mjs";
import { makeWorld, runCli } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;
const { fitJingle, nextJingle, pickJingle, readWav, tenantJingles } = await import("../scripts/music.mjs");
const { createStoryCampaign } = await import("../scripts/story.mjs");
const { resolveVariants, scaffold } = await import("../scripts/video.mjs");
const { loadTenant } = await import("../scripts/config.mjs");

const MUSIC_KEY = "el-test-key-0123456789";
const SR = 48000;

/** A 16-bit stereo WAV holding a constant level, so gains are easy to read back. */
function flatWav(seconds, level = 10000) {
  const frames = Math.round(seconds * SR);
  const pcm = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames * 2; i++) pcm.writeInt16LE(level, i * 2);
  return wav(pcm, SR, 2);
}

let server, port, calls = [], fakeFfmpeg;
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, key: req.headers["xi-api-key"], body: body ? JSON.parse(body) : null });
      if (req.headers["xi-api-key"] !== MUSIC_KEY) { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ detail: "invalid key" })); }
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.from("ID3-fake-mp3"));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  // fake ffmpeg: writes a 20s WAV to its last argument, as the real one would after decoding
  const dir = join(world.root, "fakeffmpeg");
  mkdirSync(dir, { recursive: true });
  fakeFfmpeg = join(dir, "ffmpeg");
  writeFileSync(fakeFfmpeg, `#!/usr/bin/env node
const fs = require("node:fs");
const out = process.argv[process.argv.length - 1];
const frames = 20 * 48000, pcm = Buffer.alloc(frames * 4);
for (let i = 0; i < frames * 2; i++) pcm.writeInt16LE(8000, i * 2);
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(48000, 24);
h.writeUInt32LE(48000 * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(out, Buffer.concat([h, pcm]));
`);
  chmodSync(fakeFfmpeg, 0o755);
});
after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));

const ENV = (extra = {}) => ({ ...world.env, ZIGGY_ELEVENLABS_BASE_URL: `http://127.0.0.1:${port}`, ZIGGY_FFMPEG_BIN: fakeFfmpeg, ...extra });

test("ziggy jingle refuses to run without the key, and says how to inject it", async () => {
  const env = ENV();
  delete env.ELEVENLABS_API_KEY;
  const r = await runCli(["jingle", "acme", "--prompt", "a test jingle"], env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ELEVENLABS_API_KEY is not set — run through hush/);
  assert.equal(calls.length, 0);
});

test("ziggy jingle composes instrumental tracks into a numbered set in the brand dir", async () => {
  const r = await runCli(["jingle", "acme", "--prompt", "light modern news jingle", "--seconds", "28", "--json"], ENV({ ELEVENLABS_API_KEY: MUSIC_KEY }));
  assert.equal(r.status, 0, r.stderr);
  const call = calls.at(-1);
  assert.equal(call.method, "POST");
  assert.equal(call.url, "/v1/music?output_format=mp3_44100_192");
  assert.equal(call.key, MUSIC_KEY);
  assert.deepEqual(call.body, { prompt: "light modern news jingle", music_length_ms: 28000, force_instrumental: true });
  const [first] = JSON.parse(r.stdout);
  assert.equal(first.name, "01");
  assert.match(first.mp3, /brand\/jingles\/01\.mp3$/);
  assert.equal(readFileSync(first.mp3, "utf8"), "ID3-fake-mp3");
  assert.equal(readWav(readFileSync(first.wav)).channels, 2);
  assert.ok(!r.stdout.includes(MUSIC_KEY) && !r.stderr.includes(MUSIC_KEY), "the key is never printed");
  // --count adds to the set, never overwrites it
  const more = await runCli(["jingle", "acme", "--prompt", "light modern news jingle", "--count", "2", "--json"], ENV({ ELEVENLABS_API_KEY: MUSIC_KEY }));
  assert.equal(more.status, 0, more.stderr);
  assert.deepEqual(JSON.parse(more.stdout).map((x) => x.name), ["02", "03"]);
  assert.deepEqual(tenantJingles("acme").map((f) => f.slice(-6)), ["01.wav", "02.wav", "03.wav"]);
});

test("jingles rotate: each new story campaign is stamped with the next one in the set", async () => {
  assert.deepEqual([nextJingle("acme"), nextJingle("acme"), nextJingle("acme"), nextJingle("acme")], ["01", "02", "03", "01"]);
  const tenant = loadTenant("acme");
  const story = { slug: "harbour-reopens-after-the-storm-1a2b3c4d", title: "Harbour reopens after the storm", dek: "Boats are back.", url: "https://acme.example/#/b/harbour", date: "2026-10-08T06:00:00Z", section: "Cronaca", image: null, sources: 2, languages: 1 };
  const made = await createStoryCampaign(tenant, { story, summarize: false });
  assert.equal(made.campaign.audio.jingle, "02", "the rotation continues from the last pick");
  // the stamp wins; an unknown or missing stamp falls back to a stable pick by name
  assert.match(pickJingle("acme", { name: "x", audio: { jingle: "03" } }), /03\.wav$/);
  assert.equal(pickJingle("acme", { name: "same" }), pickJingle("acme", { name: "same", audio: { jingle: "99" } }));
});

test("ziggy jingle surfaces an ElevenLabs refusal", async () => {
  const r = await runCli(["jingle", "acme", "--prompt", "x"], ENV({ ELEVENLABS_API_KEY: "wrong-key" }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ElevenLabs music → 401/);
});

test("fitJingle cuts to the reel length with a fade in, a fade out, and pads a short jingle", () => {
  const src = join(world.root, "flat.wav");
  writeFileSync(src, flatWav(3));
  const dest = join(world.root, "fit.wav");
  fitJingle(src, dest, { seconds: 2, fadeIn: 0.1, fadeOut: 0.5 });
  const { pcm, sampleRate, channels } = readWav(readFileSync(dest));
  assert.equal(sampleRate, SR);
  assert.equal(channels, 2);
  assert.equal(pcm.length, 2 * SR * 4);
  const at = (sec) => pcm.readInt16LE(Math.round(sec * SR) * 4);
  assert.equal(at(0), 0, "starts from silence");
  assert.equal(at(1), 10000, "full level in the middle");
  assert.ok(Math.abs(at(1.75) - 5000) < 50, "halfway down the fade out");
  assert.equal(pcm.readInt16LE(pcm.length - 4), 0, "ends in silence");
  // a jingle shorter than the reel fades out where it ends, then silence
  fitJingle(src, dest, { seconds: 4, fadeIn: 0.1, fadeOut: 0.5 });
  const long = readWav(readFileSync(dest)).pcm;
  assert.equal(long.length, 4 * SR * 4);
  assert.equal(long.readInt16LE(Math.round(3.5 * SR) * 4), 0);
});

test("a story reel takes the tenant's jingle instead of the synthesized bed", async () => {
  const tenant = loadTenant("acme");
  assert.ok(existsSync(join(world.home, "tenants", "acme", "brand", "jingles", "01.wav")), "composed by the test above");
  const campaign = {
    name: "jingled", dir: join(world.repo, "tenants", "acme", "campaigns", "jingled"), template: "story", language: "en", duration: 13,
    copy: { kicker: "Science · 5 Oct 2026", headline: "A test headline", dek: "A test dek.", points: ["One point here."], meta: "2 sources · 1 language", url: "acme.example" },
    image: null, audio: { bed: "ambient", volume: 0.6, jingle: "02" },
  };
  const [reel] = await scaffold({ tenant, campaign, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "jingled") });
  const bed = readWav(readFileSync(join(reel.dir, "assets", "bed.wav")));
  assert.equal(bed.pcm.length, 13 * SR * 4, "cut to the reel's 13 seconds");
  assert.equal(bed.pcm.readInt16LE(Math.round(1 * SR) * 4), 8000, "the jingle's level, not the synthesized pad");
  // audio.jingle: false keeps the synthesized bed
  const [plain] = await scaffold({ tenant, campaign: { ...campaign, audio: { ...campaign.audio, jingle: false } }, variants: resolveVariants(campaign, ["reel"]), outRoot: join(world.root, "plain") });
  assert.notEqual(readWav(readFileSync(join(plain.dir, "assets", "bed.wav"))).pcm.readInt16LE(Math.round(1 * SR) * 4), 8000);
});
