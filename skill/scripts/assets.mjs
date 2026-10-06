/**
 * Social identity assets from brand.json: profile mark (1000 + 400 px) and the X header
 * (1500×500 + 3000×1000 @2x). Each is a one-second static HyperFrames composition captured with
 * `hyperframes snapshot`, so the same renderer draws videos and stills, and downsized with ffmpeg.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetsDir, fontsDir, workDir } from "./config.mjs";
import { installedFonts } from "./brand.mjs";
import { escapeHtml, snapshot, starField } from "./video.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TPL = join(HERE, "..", "templates", "social");

export function fontFacesCss(brand, fontFiles, indent = "      ") {
  const out = [];
  for (const role of ["display", "text", "mono"]) {
    const f = brand.fonts?.[role];
    if (!f) continue;
    const file = fontFiles.find((p) => basename(p, ".woff2") === f.family.replace(/\s+/g, ""));
    if (!file) continue;
    const ws = f.weights?.length ? f.weights : [400];
    out.push(`${indent}@font-face { font-family: "${f.family}"; src: url("assets/fonts/${basename(file)}") format("woff2"); font-weight: ${ws.length > 1 ? `${Math.min(...ws)} ${Math.max(...ws)}` : ws[0]}; font-display: block; }`);
  }
  return out.join("\n");
}

/** Monogram fallback when the site ships no SVG mark: initials of the wordmark parts. */
export function monogram(brand) {
  const parts = brand.wordmark?.parts?.length ? brand.wordmark.parts : [{ text: brand.name }];
  return parts.map((p) => p.text.trim()[0] || "").join("").toUpperCase().slice(0, 3);
}

/** The favicon SVG, re-fitted: keeps the drawing, drops hard-coded size attributes. */
export function fitMarkSvg(svg) {
  return svg.replace(/\s(width|height)="[^"]*"/g, "").replace(/<svg\b/, '<svg preserveAspectRatio="xMidYMid meet"');
}

export function buildProfileProject(brand, dir, { size = 1000 } = {}) {
  mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
  const fonts = installedFonts(fontsDir(brand.slug || "_"));
  for (const f of fonts) copyFileSync(f, join(dir, "assets", "fonts", basename(f)));
  const hasSvg = Boolean(brand.mark?.svg);
  const html = readFileSync(join(TPL, "profile.html.tpl"), "utf8")
    .replace(/__FONT_FACES__/g, fontFacesCss(brand, fonts))
    .replace(/__MARK_INNER__/g, hasSvg ? fitMarkSvg(brand.mark.svg) : `<span id="monogram">${escapeHtml(monogram(brand))}</span>`)
    .replace(/__MARK_SIZE__/g, String(Math.round(size * (hasSvg ? 0.8 : 0.7))))
    .replace(/__MONO_SIZE__/g, String(Math.round(size * 0.34)))
    .replace(/__DISPLAY_FAMILY__/g, brand.fonts?.display?.family || "sans-serif")
    .replace(/__NAME__/g, escapeHtml(brand.name))
    .replace(/__BG__/g, brand.palette.bg).replace(/__FG__/g, brand.palette.fg)
    .replace(/__W__/g, String(size));
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }, null, 2) + "\n");
  return dir;
}

export function buildHeaderProject(brand, dir, { w = 3000, h = 1000, scale = 2 } = {}) {
  mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
  const fonts = installedFonts(fontsDir(brand.slug || "_"));
  for (const f of fonts) copyFileSync(f, join(dir, "assets", "fonts", basename(f)));
  const parts = brand.wordmark?.parts?.length ? brand.wordmark.parts : [{ text: brand.name, weight: 600 }];
  const partsHtml = parts.map((p) => `<span class="part" style="font-weight: ${p.weight}">${escapeHtml(p.text)}</span>`).join("");
  const stars = brand.stars === false ? [] : starField(26, w, h, 4242);
  const starsHtml = stars.map((s) => `<i class="star ${s.tone}" style="left:${s.x}px;top:${s.y}px;width:${s.s * scale}px;height:${s.s * scale}px;opacity:${(s.base * 0.7).toFixed(2)}"></i>`).join("");
  const html = readFileSync(join(TPL, "header.html.tpl"), "utf8")
    .replace(/__FONT_FACES__/g, fontFacesCss(brand, fonts))
    .replace(/__STARS__/g, starsHtml)
    .replace(/__PARTS__/g, partsHtml)
    .replace(/__DOT__/g, brand.wordmark?.accentDot === false ? "" : '<span class="dot"></span>')
    .replace(/__TAGLINE__/g, escapeHtml(brand.tagline || ""))
    .replace(/__LETTER_SPACING__/g, brand.wordmark?.letterSpacing || "0")
    .replace(/__TEXT_TRANSFORM__/g, brand.wordmark?.transform || "none")
    .replace(/__DISPLAY_FAMILY__/g, brand.fonts?.display?.family || "sans-serif")
    .replace(/__TEXT_FAMILY__/g, brand.fonts?.text?.family || "sans-serif")
    .replace(/__NAME__/g, escapeHtml(brand.name))
    .replace(/__BG__/g, brand.palette.bg).replace(/__FG__/g, brand.palette.fg).replace(/__MUTED__/g, brand.palette.muted)
    .replace(/__LINE__/g, brand.palette.line).replace(/__ACCENT__/g, brand.palette.accent)
    .replace(/__MARK__/g, String(104 * scale)).replace(/__TAG__/g, String(27 * scale)).replace(/__TAG_MAX__/g, String(1150 * scale))
    .replace(/__RULE_W__/g, String(72 * scale)).replace(/__RULE_MT__/g, String(40 * scale)).replace(/__RULE_MB__/g, String(32 * scale)).replace(/__LIFT__/g, String(6 * scale))
    .replace(/__W__/g, String(w)).replace(/__H__/g, String(h));
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }, null, 2) + "\n");
  return dir;
}

export function ffmpegBin() {
  return process.env.ZIGGY_FFMPEG_BIN || "ffmpeg";
}

export function resize(src, dst, w, h) {
  const r = spawnSync(ffmpegBin(), ["-v", "error", "-y", "-i", src, "-vf", `scale=${w}:${h}:flags=lanczos`, dst], { encoding: "utf8" });
  if (r.error) throw new Error(r.error.code === "ENOENT" ? "ffmpeg not found (brew install ffmpeg)" : r.error.message);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  return dst;
}

/** Build + capture + resize. Returns { profile1000, profile400, header1500, header3000 }. */
export function produceAssets(tenant, { version, log = () => {} } = {}) {
  const brand = { ...tenant.brand, slug: tenant.slug };
  const out = assetsDir(tenant.slug);
  const work = workDir(tenant.slug, "assets-src");
  const profileDir = buildProfileProject(brand, join(work, "profile"));
  const headerDir = buildHeaderProject(brand, join(work, "header"));
  const results = {};

  log("→ profile mark 1000×1000");
  const p = snapshot(profileDir, { at: 0.5, outDir: join(profileDir, "snapshots"), version })[0];
  if (!p) throw new Error("profile snapshot produced no frame");
  results.profile1000 = join(out, `${tenant.slug}-profile-1000.png`);
  copyFileSync(p, results.profile1000);
  results.profile400 = resize(results.profile1000, join(out, `${tenant.slug}-profile-400.png`), 400, 400);
  if (brand.mark?.svg) writeFileSync(join(out, `${tenant.slug}-profile.svg`), brand.mark.svg.trim() + "\n");

  log("→ X header 3000×1000 (@2x)");
  const hdr = snapshot(headerDir, { at: 0.5, outDir: join(headerDir, "snapshots"), version })[0];
  if (!hdr) throw new Error("header snapshot produced no frame");
  results.header3000 = join(out, `${tenant.slug}-x-header-3000x1000@2x.png`);
  copyFileSync(hdr, results.header3000);
  results.header1500 = resize(results.header3000, join(out, `${tenant.slug}-x-header-1500x500.png`), 1500, 500);

  writeFileSync(join(out, "manifest.json"), JSON.stringify({ tenant: tenant.slug, at: new Date().toISOString(), ...results }, null, 2) + "\n");
  return results;
}

export function assetsManifest(slug) {
  const file = join(assetsDir(slug), "manifest.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
