/**
 * Instagram carousel stills. A feed post with 2–10 images is a carousel; these are static
 * cards (1080×1350), captured with the same HyperFrames snapshot as the profile mark, not a video.
 *
 *   slide-cover  photo, kicker, headline
 *   slide-dek    the paragraph
 *   slide-close  sources, an optional short line (copy.cta), wordmark, url
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontsDir, rendersDir, videosDir } from "./config.mjs";
import { installedFonts } from "./brand.mjs";
import { fontFacesCss } from "./assets.mjs";
import { check, escapeHtml, readManifest, snapshot, starField } from "./video.mjs";

const TPL = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "social", "slide.html.tpl");
export const SLIDE_W = 1080;
export const SLIDE_H = 1350;
export const SLIDE_IDS = ["slide-cover", "slide-dek", "slide-close"];

function shown(value, display = "block") {
  return value ? display : "none";
}

export function slideSpecs(campaign) {
  const c = campaign.copy || {};
  const headline = c.headline || c.teaser || "";
  const dek = c.dek || c.tagline || "";
  return [
    { id: "slide-cover", layout: "cover", kicker: c.kicker || "", headline, dek: "", meta: "", cta: "", url: c.url || "" },
    { id: "slide-dek", layout: "text", kicker: c.kicker || "", headline: "", dek, meta: "", cta: "", url: c.url || "" },
    { id: "slide-close", layout: "close", kicker: "", headline: "", dek: c.close || "", meta: c.meta || "", cta: c.cta || "", url: c.url || "" },
  ];
}

function brandHtml(brand) {
  const parts = brand.wordmark?.parts?.length ? brand.wordmark.parts : [{ text: brand.name, weight: 600 }];
  const html = parts.map((p) => `<span class="part" style="font-weight: ${p.weight}">${escapeHtml(p.text)}</span>`).join("");
  const dot = brand.wordmark?.accentDot === false ? "" : '<span class="dot"></span>';
  return { html, dot };
}

async function placeImage(ref, dir, campaignDir, fetchImpl) {
  if (!ref) return "";
  const ext = (String(ref).split("?")[0].match(/\.(jpe?g|png|webp)$/i) || [, "jpg"])[1].toLowerCase();
  const target = join(dir, "assets", `story.${ext}`);
  if (/^https?:\/\//i.test(ref)) {
    const res = await fetchImpl(ref, { headers: { "User-Agent": "Mozilla/5.0 ziggy" } });
    if (!res.ok) throw new Error(`image ${ref} → ${res.status}`);
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  } else {
    const src = ref.startsWith("/") || !campaignDir ? ref : join(campaignDir, ref);
    if (!existsSync(src)) throw new Error(`image not found: ${src}`);
    copyFileSync(src, target);
  }
  return `assets/story.${ext}`;
}

/** Write one static slide project. Returns its directory. */
export async function buildSlideProject(tenant, campaign, spec, dir, { fetchImpl = fetch } = {}) {
  const brand = tenant.brand;
  mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
  const fonts = installedFonts(fontsDir(tenant.slug));
  for (const f of fonts) copyFileSync(f, join(dir, "assets", "fonts", basename(f)));
  const imageSrc = spec.layout === "cover" ? await placeImage(campaign.image, dir, campaign.dir, fetchImpl) : "";
  const stars = brand.stars === false ? [] : starField(28, SLIDE_W, SLIDE_H, [...spec.id].reduce((a, ch) => a + ch.charCodeAt(0), 0));
  const starsHtml = stars.map((s) => `<i class="star ${s.tone}" style="left:${s.x}px;top:${s.y}px;width:${s.s}px;height:${s.s}px;opacity:${(s.base * 0.85).toFixed(2)}"></i>`).join("");
  const mark = brandHtml(brand);
  const bg = brand.palette.bg || "#07080b";
  const rgb = bg.replace("#", "");
  const n = rgb.length === 3 ? rgb.split("").map((c) => parseInt(c + c, 16)) : [rgb.slice(0, 2), rgb.slice(2, 4), rgb.slice(4, 6)].map((h) => parseInt(h, 16));
  const html = readFileSync(TPL, "utf8")
    .replace(/__FONT_FACES__/g, fontFacesCss(brand, fonts, "      "))
    .replace(/__STARS__/g, starsHtml)
    .replace(/__LAYOUT__/g, spec.layout)
    .replace(/__PHOTO_DISPLAY__/g, imageSrc ? "block" : "none")
    .replace(/__IMAGE_SRC__/g, imageSrc)
    .replace(/__TOP__/g, spec.layout === "cover" ? "820" : "120")
    .replace(/__KICKER_DISPLAY__/g, shown(spec.kicker, "flex"))
    .replace(/__HEADLINE_DISPLAY__/g, shown(spec.headline))
    .replace(/__DEK_DISPLAY__/g, shown(spec.dek))
    .replace(/__CTA_DISPLAY__/g, shown(spec.cta))
    .replace(/__META_DISPLAY__/g, shown(spec.meta))
    .replace(/__KICKER__/g, escapeHtml(spec.kicker))
    .replace(/__HEADLINE__/g, escapeHtml(spec.headline))
    .replace(/__DEK__/g, escapeHtml(spec.dek))
    .replace(/__CTA__/g, escapeHtml(spec.cta))
    .replace(/__META__/g, escapeHtml(spec.meta))
    .replace(/__URL__/g, escapeHtml(spec.url))
    .replace(/__BRAND__/g, mark.html)
    .replace(/__DOT__/g, mark.dot)
    .replace(/__LETTER_SPACING__/g, brand.wordmark?.letterSpacing || "0")
    .replace(/__TEXT_TRANSFORM__/g, brand.wordmark?.transform || "none")
    .replace(/__DISPLAY_FAMILY__/g, brand.fonts?.display?.family || "sans-serif")
    .replace(/__TEXT_FAMILY__/g, brand.fonts?.text?.family || "sans-serif")
    .replace(/__MONO_FAMILY__/g, brand.fonts?.mono?.family || "monospace")
    .replace(/__BG_RGB__/g, `${n[0]}, ${n[1]}, ${n[2]}`)
    .replace(/__BG__/g, bg).replace(/__FG__/g, brand.palette.fg).replace(/__MUTED__/g, brand.palette.muted)
    .replace(/__LINE__/g, brand.palette.line).replace(/__ACCENT__/g, brand.palette.accent)
    .replace(/__NAME__/g, escapeHtml(brand.name))
    .replace(/__LANG__/g, campaign.language || "en")
    .replace(/__W__/g, String(SLIDE_W)).replace(/__H__/g, String(SLIDE_H));
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    authoringSkill: "motion-graphics",
  }, null, 2) + "\n");
  return dir;
}

/** Snapshot every slide and merge the PNGs into the campaign render manifest. */
export async function produceSlides({ tenant, campaign, version, log = () => {}, skipCheck = false, fetchImpl } = {}) {
  if (!tenant.brand) throw new Error(`tenant ${tenant.slug} has no brand.json — run: ziggy brand extract ${tenant.slug}`);
  if (!installedFonts(fontsDir(tenant.slug)).length) throw new Error(`no fonts — run: ziggy brand fonts ${tenant.slug}`);
  const outDir = rendersDir(tenant.slug, campaign.name);
  const outputs = {};
  for (const spec of slideSpecs(campaign)) {
    const dir = join(videosDir(tenant.slug, campaign.name), spec.id);
    log(`→ ${spec.id} (${SLIDE_W}×${SLIDE_H})`);
    await buildSlideProject(tenant, campaign, spec, dir, { fetchImpl });
    if (!skipCheck) {
      const c = check(dir, { version });
      if (!c.ok) throw new Error(`hyperframes check failed for ${spec.id}:\n${c.errors.join("\n") || c.output.slice(-1200)}`);
      log(`  check ok${c.warnings.length ? ` (${c.warnings.length} warning(s))` : ""}`);
    }
    const frames = snapshot(dir, { at: 0.5, outDir: join(dir, "snapshots"), version });
    if (!frames[0]) throw new Error(`snapshot produced no frame for ${spec.id}`);
    const still = join(outDir, `${tenant.slug}-${campaign.name}-${spec.id}-${SLIDE_W}x${SLIDE_H}.png`);
    copyFileSync(frames[0], still);
    log(`  ${still}`);
    outputs[spec.id] = { project: dir, still, w: SLIDE_W, h: SLIDE_H, purpose: "instagram_carousel" };
  }
  const prev = readManifest(tenant.slug, campaign.name) || { tenant: tenant.slug, campaign: campaign.name, outputs: {} };
  const manifest = { ...prev, tenant: tenant.slug, campaign: campaign.name, renderedAt: new Date().toISOString(), outputs: { ...(prev.outputs || {}), ...outputs } };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
