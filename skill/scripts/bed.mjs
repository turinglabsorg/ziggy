/**
 * Deterministic beds (16-bit stereo WAV). Same inputs → byte-identical file, so a tenant's
 * re-renders are identical months later. No dependencies.
 *
 * The mood is named by the campaign's `audio.bed` (`MOODS` below) and picked per tenant with
 * `social.bed`; "ambient" is the default and stays byte-stable. Every mood layers a pad keyed
 * to the brand, filtered noise with a swell that crests on the wordmark reveal, and blips on
 * the campaign's beats; `beats` and `swellAt` move with the timeline when a template changes
 * its timing.
 */
import { writeFileSync } from "node:fs";

/** pad: "drone" (deep, detuned) or "fifth" (brighter, baseHz + fifth); tick: a quiet news-clock pulse. */
const MOODS = {
  ambient: { baseHz: 55, pad: "drone" },
  news: { baseHz: 110, pad: "fifth", tick: { at: 0.9, every: 0.75, hz: 2360, len: 0.05, gain: 0.022 } },
};

export function renderBed({ seconds = 7.5, sampleRate = 48000, seed = 20261005, swellAt = 3.45, beats = [[0.55, 1318.5, 1.2, 0.09], [3.55, 659.3, 1.6, 0.07], [5.45, 987.8, 0.9, 0.035]], peak = 0.6, baseHz, variant = "ambient" } = {}) {
  const mood = MOODS[variant] || MOODS.ambient;
  baseHz = baseHz ?? mood.baseHz;
  const n = Math.round(seconds * sampleRate);
  const rand = mulberry32(seed);
  const left = new Float64Array(n);
  const right = new Float64Array(n);

  const env = (t, attack, release) => {
    const a = Math.min(1, Math.max(0, t / attack));
    const r = Math.min(1, Math.max(0, (seconds - t) / release));
    return Math.min(a, r) ** 1.6;
  };

  // one-pole low-pass (applied twice) for the air layer
  const rc = 1 / (2 * Math.PI * 900);
  const alpha = (1 / sampleRate) / (rc + 1 / sampleRate);
  const noise = new Float64Array(n);
  for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1;
  for (let pass = 0; pass < 2; pass++) {
    let acc = 0;
    for (let i = 0; i < n; i++) { acc += alpha * (noise[i] - acc); noise[i] = acc; }
  }

  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.11 * t);
    let pad;
    if (mood.pad === "fifth") {
      pad = (0.5 * Math.sin(2 * Math.PI * baseHz * t) + 0.3 * Math.sin(2 * Math.PI * (baseHz * 1.5 + 0.2) * t + 0.4) + 0.15 * Math.sin(2 * Math.PI * (baseHz * 2 - 0.1) * t + 1.1) * lfo) * env(t, 1.1, 1.2) * 0.2;
    } else {
      pad = (0.55 * Math.sin(2 * Math.PI * baseHz * t) + 0.35 * Math.sin(2 * Math.PI * (baseHz * 2 + 0.3) * t + 0.4) + 0.18 * Math.sin(2 * Math.PI * (baseHz * 3 - 0.2) * t + 1.1) * lfo) * env(t, 1.8, 1.4) * 0.22;
    }
    const swell = Math.exp(-((t - swellAt) ** 2) / (2 * 0.55 ** 2));
    const air = noise[i] * (0.012 + 0.07 * swell) * env(t, 1.0, 1.2);
    let blips = 0;
    for (const [t0, hz, len, gain] of beats) {
      const tt = t - t0;
      if (tt >= 0) blips += gain * Math.exp(-tt / (len / 4)) * Math.sin(2 * Math.PI * hz * tt);
    }
    let tick = 0;
    if (mood.tick) {
      const tt = (t - mood.tick.at) % mood.tick.every;
      if (t >= mood.tick.at && tt < mood.tick.len * 4) tick = mood.tick.gain * Math.exp(-tt / mood.tick.len) * Math.sin(2 * Math.PI * mood.tick.hz * tt);
    }
    const mono = pad + air + blips + tick;
    const width = 0.015 * Math.sin(2 * Math.PI * 0.07 * t) * air;
    left[i] = mono + width;
    right[i] = mono - width;
    maxAbs = Math.max(maxAbs, Math.abs(left[i]), Math.abs(right[i]));
  }
  const scale = maxAbs > 0 ? peak / maxAbs : 1;

  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(left[i] * scale * 32767), i * 4);
    data.writeInt16LE(Math.round(right[i] * scale * 32767), i * 4 + 2);
  }
  return wav(data, sampleRate, 2);
}

export function writeBed(file, opts) {
  const buf = renderBed(opts);
  writeFileSync(file, buf);
  return { file, bytes: buf.length };
}

export function wav(pcm, sampleRate, channels) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
