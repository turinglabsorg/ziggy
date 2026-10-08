/**
 * The tenant's jingle: one instrumental track composed by ElevenLabs Music from
 * `tenant.json → music.prompt`. It is stored as a 16-bit WAV in the tenant's brand dir, and
 * each reel takes it in place of the synthesized bed, cut to the reel's length with a short
 * fade in and a fade out.
 *
 * The key reaches the command only as ELEVENLABS_API_KEY in the environment (`hush run`).
 * It is never read from a file or written anywhere.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wav } from "./bed.mjs";
import { workDir } from "./config.mjs";

export const MUSIC_KEY_ENV = "ELEVENLABS_API_KEY";
export const DEFAULT_JINGLE_SECONDS = 30;

export function jinglePath(slug) {
  return join(workDir(slug, "brand"), "jingle.wav");
}

/** The tenant's jingle WAV, or null when none has been composed yet. */
export function tenantJingle(slug) {
  const file = jinglePath(slug);
  return existsSync(file) ? file : null;
}

/**
 * Compose the jingle and store it as `brand/jingle.mp3` (to listen to) plus `brand/jingle.wav`
 * (48 kHz stereo, what the reels use). ffmpeg decodes the mp3; ZIGGY_FFMPEG_BIN swaps it in tests.
 */
export async function composeJingle(tenant, { prompt, seconds = tenant.music?.seconds || DEFAULT_JINGLE_SECONDS, fetchImpl = fetch } = {}) {
  const key = process.env[MUSIC_KEY_ENV];
  if (!key) throw new Error(`${MUSIC_KEY_ENV} is not set — run through hush: hush run --name <secret> --env ${MUSIC_KEY_ENV} --redact -- ziggy jingle ${tenant.slug}`);
  const text = prompt || tenant.music?.prompt;
  if (!text) throw new Error(`tenant ${tenant.slug} has no music.prompt in tenant.json — pass --prompt`);
  const base = process.env.ZIGGY_ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
  const body = { prompt: text, music_length_ms: Math.round(seconds * 1000), force_instrumental: true };
  if (tenant.music?.model) body.model_id = tenant.music.model;
  const res = await fetchImpl(`${base}/v1/music?output_format=mp3_44100_192`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ElevenLabs music → ${res.status} ${(await res.text()).slice(0, 300)}`);
  const mp3 = Buffer.from(await res.arrayBuffer());
  const dir = workDir(tenant.slug, "brand");
  const mp3File = join(dir, "jingle.mp3");
  writeFileSync(mp3File, mp3);
  const wavFile = jinglePath(tenant.slug);
  const ffmpeg = process.env.ZIGGY_FFMPEG_BIN || "ffmpeg";
  const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-i", mp3File, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", wavFile], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg could not decode the jingle: ${(r.stderr || r.error?.message || "").trim().slice(0, 300)}`);
  return { mp3: mp3File, wav: wavFile, bytes: mp3.length, seconds, prompt: text };
}

/** Read a 16-bit PCM WAV: { sampleRate, channels, pcm }. */
export function readWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let fmt = null, pcm = null;
  for (let off = 12; off + 8 <= buf.length;) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === "data") pcm = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
    off += 8 + size + (size % 2);
  }
  if (!fmt || !pcm) throw new Error("WAV without fmt/data chunks");
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`unsupported WAV: format ${fmt.format}, ${fmt.bits}-bit (16-bit PCM only)`);
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, pcm };
}

/**
 * Cut the jingle to `seconds`: short fade in, fade out over the last `fadeOut` seconds,
 * silence-padded when the jingle is shorter than the reel. Deterministic.
 */
export function fitJingle(src, dest, { seconds, fadeIn = 0.25, fadeOut = 1.8 } = {}) {
  const { sampleRate, channels, pcm } = readWav(readFileSync(src));
  const frames = Math.round(seconds * sampleRate);
  const have = Math.floor(pcm.length / (2 * channels));
  const out = Buffer.alloc(frames * channels * 2);
  const inF = Math.max(1, Math.round(fadeIn * sampleRate));
  const end = Math.min(frames, have);
  const outF = Math.max(1, Math.min(end, Math.round(fadeOut * sampleRate)));
  for (let f = 0; f < end; f++) {
    let g = 1;
    if (f < inF) g = f / inF;
    if (f >= end - outF) g = Math.min(g, (end - 1 - f) / outF);
    for (let c = 0; c < channels; c++) {
      const i = (f * channels + c) * 2;
      out.writeInt16LE(Math.round(pcm.readInt16LE(i) * g), i);
    }
  }
  writeFileSync(dest, wav(out, sampleRate, channels));
  return { file: dest, seconds, sampleRate, channels };
}
