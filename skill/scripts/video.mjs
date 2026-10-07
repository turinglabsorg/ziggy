/**
 * HyperFrames projects from a template + a tenant's brand + a campaign's copy.
 *
 * One template (skill/templates/hyperframes/<template>/) → one HyperFrames project per
 * variant (reel 9:16, x 16:9, post 4:5 …) under ~/.ziggy/tenants/<slug>/videos/<campaign>/<variant>/.
 * Each project is the shape `hyperframes init` produces (index.html host + compositions/ sub-
 * composition + assets/), so `npx hyperframes check|preview|render` work on it unchanged and the
 * HyperFrames desktop app can open it.
 *
 * Rendering shells out to the pinned HyperFrames CLI. Tests swap the binary (ZIGGY_HYPERFRAMES_BIN).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBed, mulberry32 } from "./bed.mjs";
import { fontsDir, videosDir, rendersDir } from "./config.mjs";
import { hexToRgb, installedFonts } from "./brand.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = join(HERE, "..", "templates", "hyperframes");
export const DEFAULT_HYPERFRAMES_VERSION = "0.8.133";

export const DEFAULT_VARIANTS = {
  reel: { w: 1080, h: 1920, layout: "stacked", mark: 150, teaser: 46, tag: 38, tagMax: 780, url: 30, orbitK: 0.78, stars: 46, pad: 120, purpose: "instagram_reel" },
  x:    { w: 1920, h: 1080, layout: "line",    mark: 136, teaser: 42, tag: 34, tagMax: 1560, url: 28, orbitK: 0.46, stars: 52, pad: 120, purpose: "twitter" },
  post: { w: 1080, h: 1350, layout: "stacked", mark: 150, teaser: 46, tag: 38, tagMax: 780, url: 30, orbitK: 0.78, stars: 38, pad: 110, purpose: "instagram_post" },
};

/** Per-template layout numbers merged over DEFAULT_VARIANTS (a template may also drop variants). */
export const TEMPLATE_VARIANTS = {
  story: {
    reel: { padTop: 250, padBottom: 300, photoTop: 0, photoH: 960, spacer: 690, kicker: 26, headline: 62, dek: 38, dekMax: 820, dekMt: 30, meta: 22, brand: 40 },
    post: { padTop: 110, padBottom: 110, photoTop: 0, photoH: 675, spacer: 650, kicker: 24, headline: 56, dek: 30, dekMax: 840, dekMt: 24, meta: 20, brand: 36 },
    x: false,
  },
};

export function listTemplates() {
  return readdirSync(TEMPLATES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Seeded star field: sparse points, the centre band kept clearer so type stays readable. */
export function starField(n, w, h, seed) {
  const rand = mulberry32(seed);
  const out = [];
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const uni = (a, b) => a + rand() * (b - a);
  for (let i = 0; i < n; i++) {
    const x = uni(0.03, 0.97), y = uni(0.03, 0.97);
    const skip = rand() < 0.7;
    if (x > 0.3 && x < 0.7 && y > 0.33 && y < 0.67 && skip) continue;
    out.push({ x: Math.round(x * w), y: Math.round(y * h), s: pick([3, 3, 3, 4, 4, 5]), tone: rand() < 0.6 ? "fg" : "muted", base: +uni(0.45, 0.95).toFixed(2), amp: +uni(0.15, 0.5).toFixed(2), cycles: pick([1, 2, 2, 3]), phase: +uni(0, 1).toFixed(2) });
  }
  return out;
}

function fontFaces(brand, fontFiles) {
  const faces = [];
  for (const role of ["display", "text", "mono"]) {
    const f = brand.fonts?.[role];
    if (!f) continue;
    const file = fontFiles.find((p) => basename(p, ".woff2") === f.family.replace(/\s+/g, ""));
    if (!file) continue;
    const ws = f.weights?.length ? f.weights : [400];
    const range = ws.length > 1 ? `${Math.min(...ws)} ${Math.max(...ws)}` : `${ws[0]}`;
    faces.push(`        @font-face { font-family: "${f.family}"; src: url("assets/fonts/${basename(file)}") format("woff2"); font-weight: ${range}; font-display: block; }`);
  }
  return faces.join("\n");
}

function words(brand) {
  const parts = brand.wordmark?.parts?.length ? brand.wordmark.parts : [{ text: brand.name, weight: 600 }];
  return parts
    .map((p, i) => {
      const letters = [...p.text].map((c) => `<span class="ch">${c === " " ? "&nbsp;" : escapeHtml(c)}</span>`).join("");
      const id = i === parts.length - 1 ? ' id="__ID__-w-last"' : "";
      return `              <span class="word"${id} style="font-weight: ${p.weight}" data-layout-allow-overflow="true">${letters}</span>`;
    })
    .join("\n");
}

/** Resolve the variant table for a campaign (campaign.variants overrides merge onto defaults). */
export function resolveVariants(campaign, only) {
  const table = { ...DEFAULT_VARIANTS };
  const disabled = new Set();
  const layer = (overrides) => {
    for (const [k, v] of Object.entries(overrides || {})) {
      if (v === false) { disabled.add(k); continue; }
      disabled.delete(k);
      table[k] = { ...(table[k] || {}), ...v };
    }
  };
  layer(TEMPLATE_VARIANTS[campaign.template || "teaser"]);
  layer(campaign.variants);
  const keys = only?.length ? only : Object.keys(table).filter((k) => !disabled.has(k));
  for (const k of keys) if (!table[k] || !table[k].w) throw new Error(`unknown variant ${JSON.stringify(k)}; known: ${Object.keys(table).join(", ")}`);
  return Object.fromEntries(keys.map((k) => [k, table[k]]));
}

/**
 * Write one HyperFrames project per variant. Returns [{ variant, dir, w, h, purpose }].
 * Pure file generation — no network, no rendering.
 */
/** Fetch or copy the campaign image into the project; returns the relative src or null. */
async function placeImage(campaign, dir, fetchImpl = fetch) {
  const ref = campaign.image;
  if (!ref) return null;
  const ext = (ref.split("?")[0].match(/\.(jpe?g|png|webp)$/i) || [, "jpg"])[1].toLowerCase();
  const target = join(dir, "assets", `story.${ext}`);
  if (/^https?:\/\//i.test(ref)) {
    if (!existsSync(target)) {
      try {
        const res = await fetchImpl(ref, { headers: { "User-Agent": "Mozilla/5.0 ziggy" } });
        if (!res.ok) throw new Error(`${res.status}`);
        await writeFile(target, Buffer.from(await res.arrayBuffer()));
      } catch {
        return null; // a story without a reachable image renders without the photo
      }
    }
  } else {
    const src = ref.startsWith("/") ? ref : join(campaign.dir || ".", ref);
    if (!existsSync(src)) throw new Error(`image not found: ${src}`);
    copyFileSync(src, target);
  }
  return `assets/story.${ext}`;
}

function brandParts(brand) {
  const parts = brand.wordmark?.parts?.length ? brand.wordmark.parts : [{ text: brand.name, weight: 600 }];
  return parts.map((p) => `<span class="part" style="font-weight: ${p.weight}">${escapeHtml(p.text)}</span>`).join("");
}

export async function scaffold({ tenant, campaign, variants, hyperframesVersion = DEFAULT_HYPERFRAMES_VERSION, outRoot, fetchImpl } = {}) {
  const brand = tenant.brand;
  if (!brand) throw new Error(`tenant ${tenant.slug} has no brand.json — run: ziggy brand extract ${tenant.slug}`);
  const template = campaign.template || "teaser";
  const tdir = join(TEMPLATES_DIR, template);
  if (!existsSync(join(tdir, "sub.html.tpl"))) throw new Error(`unknown template ${JSON.stringify(template)}; known: ${listTemplates().join(", ")}`);
  const sub = readFileSync(join(tdir, "sub.html.tpl"), "utf8");
  const host = readFileSync(join(tdir, "host.html.tpl"), "utf8");
  const duration = campaign.duration || 7.5;
  const copy = campaign.copy || {};
  const fontFiles = installedFonts(fontsDir(tenant.slug));
  const accent = hexToRgb(brand.palette.accent) || { r: 255, g: 90, b: 31 };
  const results = [];

  for (const [variant, v] of Object.entries(variants)) {
    const dir = outRoot ? join(outRoot, variant) : join(videosDir(tenant.slug, campaign.name), variant);
    mkdirSync(join(dir, "compositions"), { recursive: true });
    mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
    mkdirSync(join(dir, "renders"), { recursive: true });
    for (const f of fontFiles) copyFileSync(f, join(dir, "assets", "fonts", basename(f)));

    const id = `${template}-${variant}`;
    const stacked = v.layout === "stacked";
    const stars = brand.stars === false ? [] : starField(v.stars, v.w, v.h, [...id].reduce((a, c) => a + c.charCodeAt(0), 0) * 31);
    const starHtml = stars.map((s) => `<i class="star ${s.tone}" style="left:${s.x}px;top:${s.y}px;width:${s.s}px;height:${s.s}px;opacity:0"></i>`).join("");

    let audio = "";
    if (campaign.audio?.bed) {
      const a = campaign.audio;
      writeBed(join(dir, "assets", "bed.wav"), { seconds: duration, seed: a.seed || 20261005, swellAt: a.swellAt, beats: a.beats, baseHz: a.baseHz, variant: a.bed });
      audio = `        <audio id="${id}-bed" src="assets/bed.wav" data-start="0" data-duration="${duration}" data-volume="${a.volume ?? 0.7}"></audio>`;
    }

    const imageSrc = await placeImage(campaign, dir, fetchImpl);
    const bgRgb = hexToRgb(brand.palette.bg) || { r: 0, g: 0, b: 0 };
    const headline = copy.headline || copy.title || "";
    const headlineWords = headline.split(/\s+/).filter(Boolean).map((w) => `<span class="w">${escapeHtml(w)}</span>`).join("");
    const points = (copy.points || []).filter((p) => typeof p === "string" && p.trim()).slice(0, 4);
    const pointScenes = points.map((p, i) => `              <div class="scene point-scene" id="${id}-s${i + 1}"><span class="p-num">${String(i + 1).padStart(2, "0")}</span><span class="p-line"></span><p class="p-text">${escapeHtml(p.trim())}</p></div>`).join("\n");

    let fill = (s) => s
      .replace(/__FONT_FACES__/g, fontFaces(brand, fontFiles))
      .replace(/__STARS_JSON__/g, JSON.stringify(stars))
      .replace(/__STARS__/g, starHtml)
      .replace(/__WORDS__/g, words(brand))
      .replace(/__MARK_SVG__/g, brand.mark?.svg || "")
      .replace(/__LOGO_MB__/g, String(Math.round(v.mark * 0.45)))
      .replace(/__LOGO__/g, String(Math.round(v.mark * 0.85)))
      .replace(/__AUDIO__/g, audio)
      .replace(/__TEASER_TEXT__/g, escapeHtml(copy.teaser || ""))
      .replace(/__TAGLINE__/g, escapeHtml(copy.tagline || brand.tagline || ""))
      .replace(/__URL_TEXT__/g, copy.url === false || copy.url === "" ? "" : escapeHtml(copy.url || new URL(brand.site).hostname))
      .replace(/__ORBIT_INV_K__/g, (1 / v.orbitK).toFixed(4))
      .replace(/__ORBIT_K__/g, v.orbitK.toFixed(3))
      .replace(/__MARK_DIR__/g, stacked ? "column" : "row")
      .replace(/__MARK_GAP__/g, stacked ? "0.18em" : "0.32em")
      .replace(/__TAG_MT__/g, stacked ? "64" : "48")
      .replace(/__URL_MT__/g, stacked ? "56" : "44")
      .replace(/__TAG_MAX__/g, String(v.tagMax))
      .replace(/__TEASER__/g, String(v.teaser))
      .replace(/__MARK__/g, String(v.mark))
      .replace(/__TAG__/g, String(v.tag))
      .replace(/__URL__/g, String(v.url))
      .replace(/__DOT__/g, String(Math.round(v.mark * 0.16)))
      .replace(/__PAD__/g, String(v.pad))
      .replace(/__DUR__/g, String(duration))
      .replace(/__LETTER_SPACING__/g, brand.wordmark?.letterSpacing || "0")
      .replace(/__TEXT_TRANSFORM__/g, brand.wordmark?.transform || "none")
      .replace(/__DISPLAY_FAMILY__/g, brand.fonts?.display?.family || "sans-serif")
      .replace(/__TEXT_FAMILY__/g, brand.fonts?.text?.family || "sans-serif")
      .replace(/__MONO_FAMILY__/g, brand.fonts?.mono?.family || "monospace")
      .replace(/__BG__/g, brand.palette.bg).replace(/__FG__/g, brand.palette.fg).replace(/__MUTED__/g, brand.palette.muted)
      .replace(/__LINE__/g, brand.palette.line).replace(/__ACCENT_RGB__/g, `${accent.r}, ${accent.g}, ${accent.b}`).replace(/__ACCENT__/g, brand.palette.accent)
      .replace(/__HEADLINE_WORDS__/g, headlineWords)
      .replace(/__BRAND_PARTS__/g, brandParts(brand))
      .replace(/__BRAND_DOT__/g, brand.wordmark?.accentDot === false ? "" : '<span class="b-dot"></span>')
      .replace(/__IMAGE_SRC__/g, imageSrc || "")
      .replace(/__HAS_PHOTO__/g, imageSrc ? "true" : "false")
      .replace(/__PHOTO_DISPLAY__/g, imageSrc ? "block" : "none")
      .replace(/__BG_RGB__/g, `${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}`)
      .replace(/__PHOTO_TOP__/g, String(v.photoTop ?? 0)).replace(/__PHOTO_H__/g, String(v.photoH ?? 960))
      .replace(/__PAD_TOP__/g, String(v.padTop ?? 250)).replace(/__PAD_BOTTOM__/g, String(v.padBottom ?? 330)).replace(/__SPACER__/g, String(v.spacer ?? 690))
      .replace(/__PNUM__/g, String(Math.round((v.headline ?? 64) * 1.15))).replace(/__PTEXT__/g, String(Math.round((v.headline ?? 64) * 0.84)))
      .replace(/__FLOGO__/g, String(Math.round((v.brand ?? 40) * 1.3)))
      .replace(/__POINTS__/g, pointScenes).replace(/__POINT_N__/g, String(points.length))
      .replace(/__KICKER__/g, String(v.kicker ?? 26)).replace(/__HEADLINE__/g, String(v.headline ?? 64))
      .replace(/__DEK_MAX__/g, String(v.dekMax ?? 840)).replace(/__DEK_MT__/g, String(v.dekMt ?? 30)).replace(/__DEK__/g, String(v.dek ?? 33))
      .replace(/__META__/g, String(v.meta ?? 22)).replace(/__BRAND__/g, String(v.brand ?? 40))
      .replace(/__HOST_ID__/g, `${tenant.slug}-${campaign.name}-${variant}`)
      .replace(/__NAME__/g, escapeHtml(brand.name))
      .replace(/__LANG__/g, campaign.language || "en")
      .replace(/__ID__/g, id)
      .replace(/__W__/g, String(v.w))
      .replace(/__H__/g, String(v.h));
    const copyTokens = (s) => s.replace(/__COPY_([A-Z0-9_]+)__/g, (_, key) => escapeHtml(copy[key.toLowerCase()] ?? ""));
    const fillAll = (s) => copyTokens(fill(s));

    writeFileSync(join(dir, "compositions", `${id}.html`), fillAll(sub));
    writeFileSync(join(dir, "index.html"), fillAll(host));
    const projectName = `${tenant.slug}-${campaign.name}-${variant}`;
    writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({
      $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
      registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
      paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      media: { autoProxy: true },
      authoringSkill: "motion-graphics",
    }, null, 2) + "\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: projectName, private: true, type: "module",
      scripts: {
        dev: `npx --yes hyperframes@${hyperframesVersion} preview`,
        check: `npx --yes hyperframes@${hyperframesVersion} check`,
        render: `npx --yes hyperframes@${hyperframesVersion} render`,
      },
    }, null, 2) + "\n");
    if (!existsSync(join(dir, "meta.json"))) writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: projectName, name: projectName, createdAt: new Date().toISOString() }, null, 2) + "\n");
    writeFileSync(join(dir, "BRIEF.md"), brief(tenant, campaign, variant, v, duration));
    results.push({ variant, dir, w: v.w, h: v.h, purpose: v.purpose, id });
  }
  return results;
}

function brief(tenant, campaign, variant, v, duration) {
  return `---
workflow: motion-graphics
flow: automation
storyboard: no
tenant: ${tenant.slug}
campaign: ${campaign.name}
variant: ${variant}
aspect: ${v.w}x${v.h}
language: ${campaign.language || "en"}
length: ${duration}s
---

## Intent

${campaign.intent || `${tenant.brand.name} — ${campaign.template || "teaser"} (${variant}).`}

## Copy

- headline: ${campaign.copy?.headline || "—"}
- teaser: ${campaign.copy?.teaser || "—"}
- tagline: ${campaign.copy?.tagline || tenant.brand.tagline || "—"}
- url: ${campaign.copy?.url || tenant.brand.site}

## Generated by ziggy

Edit tenants/${tenant.slug}/campaigns/${campaign.name}/campaign.json or brand.json and re-run
\`ziggy video ${tenant.slug} ${campaign.name}\`; direct edits to this project are overwritten.
`;
}

/* ── HyperFrames CLI ─────────────────────────────────────────────────────── */

export function hyperframesArgv(version = DEFAULT_HYPERFRAMES_VERSION) {
  if (process.env.ZIGGY_HYPERFRAMES_BIN) return [process.env.ZIGGY_HYPERFRAMES_BIN];
  return ["npx", "--yes", `hyperframes@${version}`];
}

function runHf(args, cwd, version) {
  const [bin, ...pre] = hyperframesArgv(version);
  const result = spawnSync(bin, [...pre, ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(result.error.code === "ENOENT" ? `${bin} not found — install Node.js/npm (and ffmpeg) to render` : result.error.message);
  return result;
}

export function check(projectDir, { version } = {}) {
  const r = runHf(["check"], projectDir, version);
  const out = (r.stdout || "") + (r.stderr || "");
  return { ok: r.status === 0 && !/Check failed/.test(out), output: out, errors: (out.match(/✗[^\n]*/g) || []), warnings: (out.match(/⚠[^\n]*/g) || []) };
}

export function render(projectDir, { output, quality = "high", version } = {}) {
  const r = runHf(["render", ".", "--skill=motion-graphics", "-q", quality, "-o", output], projectDir, version);
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0 || !existsSync(output)) throw new Error(`render failed for ${projectDir}:\n${out.split("\n").filter((l) => /✗|Error|error/.test(l)).join("\n") || out.slice(-800)}`);
  return { output, log: out };
}

export function snapshot(projectDir, { at, outDir, version } = {}) {
  const r = runHf(["snapshot", "--at", String(at), "--no-end", "-o", outDir], projectDir, version);
  if (r.status !== 0) throw new Error(`snapshot failed: ${(r.stderr || r.stdout || "").slice(-600)}`);
  const files = readdirSync(outDir).filter((f) => f.startsWith("frame-") && f.endsWith(".png")).map((f) => join(outDir, f));
  return files;
}

/** Scaffold → check → render every variant; returns the render manifest. */
export async function produce({ tenant, campaign, variants, quality = "high", version, log = () => {}, skipCheck = false, dryRun = false }) {
  const projects = await scaffold({ tenant, campaign, variants, hyperframesVersion: version });
  const outDir = rendersDir(tenant.slug, campaign.name);
  const manifest = { tenant: tenant.slug, campaign: campaign.name, renderedAt: new Date().toISOString(), outputs: {} };
  for (const p of projects) {
    log(`→ ${p.variant} (${p.w}×${p.h}) ${p.dir}`);
    if (dryRun) { manifest.outputs[p.variant] = { project: p.dir, purpose: p.purpose }; continue; }
    if (!skipCheck) {
      const c = check(p.dir, { version });
      if (!c.ok) throw new Error(`hyperframes check failed for ${p.variant}:\n${c.errors.join("\n") || c.output.slice(-1200)}`);
      log(`  check ok${c.warnings.length ? ` (${c.warnings.length} warning(s))` : ""}`);
    }
    const file = join(outDir, `${tenant.slug}-${campaign.name}-${p.variant}-${p.w}x${p.h}.mp4`);
    render(p.dir, { output: file, quality, version });
    log(`  rendered ${file}`);
    const stillDir = join(p.dir, "snapshots", "final");
    mkdirSync(stillDir, { recursive: true });
    let still = null;
    try {
      const frames = snapshot(p.dir, { at: (campaign.duration || 7.5) - 0.05, outDir: stillDir, version });
      if (frames[0]) {
        still = join(outDir, `${tenant.slug}-${campaign.name}-${p.variant}-${p.w}x${p.h}.png`);
        copyFileSync(frames[0], still);
      }
    } catch (error) {
      log(`  still skipped: ${error.message.split("\n")[0]}`);
    }
    manifest.outputs[p.variant] = { project: p.dir, video: file, still, w: p.w, h: p.h, purpose: p.purpose };
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export function readManifest(slug, campaign) {
  const file = join(rendersDir(slug, campaign), "manifest.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}
