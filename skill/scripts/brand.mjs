/**
 * Brand extraction: a tenant's site → brand.json (palette, fonts, wordmark, mark, tagline).
 *
 * No HTML parser dependency: the extractor works on the markup and the first-party stylesheets
 * with regexes, which is enough for the CSS-variable-driven sites this targets. The result is a
 * starting point the human edits; after that, brand.json is the source of truth and nothing
 * here runs again unless asked (`ziggy brand extract --force`).
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

/* ── color helpers ──────────────────────────────────────────────────────── */

export function normalizeHex(value) {
  const v = (value || "").trim().toLowerCase();
  const m3 = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  const m6 = v.match(/^#([0-9a-f]{6})$/);
  if (m6) return `#${m6[1]}`;
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return "#" + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  return null;
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

export function luminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function saturation(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const max = Math.max(c.r, c.g, c.b) / 255, min = Math.min(c.r, c.g, c.b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

/* ── CSS parsing ─────────────────────────────────────────────────────────── */

/** `:root { --a: x; --b: y }` (every :root block) → { "--a": "x", … } */
export function parseRootVars(css) {
  const vars = {};
  const re = /:root\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    for (const decl of m[1].split(";")) {
      const [k, ...rest] = decl.split(":");
      if (k && k.trim().startsWith("--") && rest.length) vars[k.trim()] = rest.join(":").trim();
    }
  }
  return vars;
}

export function resolveVar(value, vars, depth = 0) {
  if (!value || depth > 5) return value;
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fallback) => resolveVar(vars[name] ?? fallback ?? "", vars, depth + 1));
}

/** Declarations of the first `selector { … }` block. */
export function parseBlock(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`));
  if (!m) return {};
  const out = {};
  for (const decl of m[1].split(";")) {
    const [k, ...rest] = decl.split(":");
    if (k && rest.length) out[k.trim()] = rest.join(":").trim();
  }
  return out;
}

/** Google Fonts css2 URL → [{ family, weights }] */
export function parseGoogleFontsUrl(url) {
  const out = [];
  try {
    const u = new URL(url);
    for (const fam of u.searchParams.getAll("family")) {
      const [name, spec] = fam.split(":");
      const weights = [];
      const w = spec?.match(/wght@([\d;.]+)/);
      if (w) for (const part of w[1].split(";")) { const n = Number(part.split("..").pop()); if (n) weights.push(n); }
      out.push({ family: name.replace(/\+/g, " "), weights: weights.length ? [...new Set(weights)].sort((a, b) => a - b) : [400] });
    }
  } catch { /* not a url */ }
  return out;
}

function firstFamily(fontFamilyValue) {
  if (!fontFamilyValue) return null;
  return fontFamilyValue.split(",")[0].trim().replace(/^["']|["']$/g, "") || null;
}

/* ── palette roles ───────────────────────────────────────────────────────── */

/**
 * Assign generic roles to the colors a site declares:
 *   bg      page background          fg     body text
 *   accent  most saturated color     muted  the mid-luminance neutral
 *   line    the hairline closest to bg
 */
export function assignPalette(colors, { bg, fg } = {}) {
  const uniq = [...new Set(colors.map(normalizeHex).filter(Boolean))];
  const pick = { bg: normalizeHex(bg), fg: normalizeHex(fg) };
  const byLum = [...uniq].sort((a, b) => luminance(a) - luminance(b));
  if (!pick.bg) pick.bg = byLum[0] || "#000000";
  if (!pick.fg) pick.fg = byLum[byLum.length - 1] || "#ffffff";
  const rest = uniq.filter((c) => c !== pick.bg && c !== pick.fg);
  pick.accent = rest.sort((a, b) => saturation(b) - saturation(a))[0] || pick.fg;
  const neutrals = rest.filter((c) => c !== pick.accent && saturation(c) < 0.35);
  const dark = luminance(pick.bg) < luminance(pick.fg);
  neutrals.sort((a, b) => (dark ? luminance(a) - luminance(b) : luminance(b) - luminance(a)));
  pick.line = neutrals[0] || pick.bg;
  pick.muted = neutrals.length > 1 ? neutrals[neutrals.length - 1] : (neutrals[0] || pick.fg);
  return pick;
}

/* ── HTML parsing ────────────────────────────────────────────────────────── */

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** Wordmark: an element whose class mentions wordmark/logo/brand; `<b>`/`<strong>` marks the heavy part. */
export function parseWordmark(html, { lightWeight = 300, heavyWeight = 600 } = {}) {
  const m = html.match(/<(a|div|span|h1)\b[^>]*class="[^"]*\b(wordmark|logo|brand)\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i);
  if (!m) return null;
  const inner = m[3].replace(/<span[^>]*aria-hidden="true"[^>]*><\/span>/gi, "");
  const parts = [];
  const re = /<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>|([^<]+)/g;
  let t;
  while ((t = re.exec(inner))) {
    const text = stripTags(t[2] ?? t[3] ?? "");
    if (!text) continue;
    parts.push({ text, weight: t[2] !== undefined ? heavyWeight : lightWeight });
  }
  if (!parts.length) return null;
  return { text: parts.map((p) => p.text).join(" "), parts };
}

export function parseFavicon(html, base) {
  const m = html.match(/<link[^>]*rel="(?:shortcut )?icon"[^>]*href="([^"]+)"/i) || html.match(/<link[^>]*href="([^"]+)"[^>]*rel="(?:shortcut )?icon"/i);
  if (!m) return null;
  const href = m[1];
  if (href.startsWith("data:image/svg+xml")) {
    const body = href.slice(href.indexOf(",") + 1);
    return { svg: decodeURIComponent(body.replace(/\+/g, " ")), source: "favicon-data-uri" };
  }
  return { url: new URL(href, base).toString(), source: "favicon" };
}

/* ── the extractor ───────────────────────────────────────────────────────── */

export async function fetchText(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "text/html,text/css,*/*" } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

/** Pure: html + css (+ site) → brand. Exposed for tests; `extractBrand` fetches then calls this. */
export function brandFromSources({ site, html, css }) {
  const vars = parseRootVars(css);
  const body = parseBlock(css, "body");
  const bodyBg = normalizeHex(resolveVar(body.background || body["background-color"], vars));
  const bodyFg = normalizeHex(resolveVar(body.color, vars));
  const colorVars = Object.fromEntries(Object.entries(vars).filter(([, v]) => normalizeHex(v)));
  const palette = assignPalette(Object.values(colorVars), { bg: bodyBg, fg: bodyFg });
  // variable names beat luminance guesses when a site names its roles
  const byName = (patterns) => { for (const [k, v] of Object.entries(colorVars)) if (patterns.some((p) => p.test(k))) return normalizeHex(v); return null; };
  palette.line = byName([/hair/, /^--line/, /border/, /rule/, /divider/, /stroke/]) || palette.line;
  palette.muted = byName([/muted/, /dust/, /dim/, /secondary/, /subtle/]) || palette.muted;
  palette.accent = byName([/accent/, /flare/, /primary/, /brand/, /highlight/]) || palette.accent;

  const gfLink = (html.match(/https:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s>]+/) || [])[0]?.replace(/&amp;/g, "&") || null;
  const googleFonts = gfLink ? parseGoogleFontsUrl(gfLink) : [];
  const fontVars = Object.fromEntries(Object.entries(vars).filter(([k, v]) => /font|display|text|mono|sans|serif/.test(k) && /,/.test(v)));
  const roleFamily = (keys) => { for (const k of keys) if (fontVars[k]) return firstFamily(fontVars[k]); return null; };
  const bodyFamily = firstFamily(resolveVar(body["font-family"], vars));
  const wordmarkBlock = parseBlock(css, ".wordmark");
  const displayFamily = roleFamily(["--display", "--font-display", "--heading"]) || firstFamily(resolveVar(wordmarkBlock["font-family"], vars)) || googleFonts[0]?.family || bodyFamily;
  const textFamily = roleFamily(["--text", "--font-text", "--body", "--font-body"]) || bodyFamily || googleFonts[0]?.family;
  const monoFamily = roleFamily(["--mono", "--font-mono"]) || googleFonts.find((f) => /mono/i.test(f.family))?.family || null;
  const weightsOf = (family) => googleFonts.find((f) => f.family === family)?.weights || [400];
  const fonts = {
    display: displayFamily ? { family: displayFamily, weights: weightsOf(displayFamily) } : null,
    text: textFamily ? { family: textFamily, weights: weightsOf(textFamily) } : null,
    mono: monoFamily ? { family: monoFamily, weights: weightsOf(monoFamily) } : null,
    google: gfLink,
  };

  const wmWeights = { lightWeight: Number(wordmarkBlock["font-weight"]) || 300, heavyWeight: Number(parseBlock(css, ".wordmark b")["font-weight"]) || 600 };
  const wordmark = parseWordmark(html, wmWeights);
  const title = stripTags((html.match(/<title>([\s\S]*?)<\/title>/i) || [, ""])[1]);
  const description = (html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"/i) || [, ""])[1];
  const lang = (html.match(/<html[^>]*lang="([a-zA-Z-]+)"/) || [, "en"])[1];

  return {
    name: wordmark?.text || title || new URL(site).hostname,
    site,
    lang,
    tagline: description || null,
    palette: { ...palette, raw: colorVars },
    fonts,
    wordmark: wordmark
      ? { ...wordmark, transform: wordmarkBlock["text-transform"] || "none", letterSpacing: wordmarkBlock["letter-spacing"] || "0", accentDot: /\.moon|\.dot|\.flare|\.accent/.test(css) }
      : { text: title, parts: [{ text: title, weight: 600 }], transform: "none", letterSpacing: "0", accentDot: false },
    mark: parseFavicon(html, site),
    stars: /radial-gradient\(\s*1(?:\.5)?px/.test(css),
    extractedAt: new Date().toISOString(),
  };
}

export async function extractBrand(site, { fetchImpl = fetch } = {}) {
  const base = new URL(site).toString();
  const html = await fetchText(base, fetchImpl);
  const hrefs = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi)].map((m) => m[1]).filter((h) => !/fonts\.googleapis/.test(h));
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const sheets = [];
  for (const href of hrefs) {
    try { sheets.push(await fetchText(new URL(href, base).toString(), fetchImpl)); } catch { /* skip dead sheet */ }
  }
  return brandFromSources({ site: base, html, css: [...inline, ...sheets].join("\n") });
}

/* ── fonts ───────────────────────────────────────────────────────────────── */

/** Download the brand's Google families as variable woff2 into `dir`; returns { Family: path }. */
export async function downloadFonts(brand, dir, { fetchImpl = fetch } = {}) {
  mkdirSync(dir, { recursive: true });
  const families = [brand.fonts?.display, brand.fonts?.text, brand.fonts?.mono].filter(Boolean);
  const out = {};
  for (const f of families) {
    const file = join(dir, `${f.family.replace(/\s+/g, "")}.woff2`);
    out[f.family] = file;
    if (existsSync(file)) continue;
    const spec = f.weights.length > 1 ? `wght@${Math.min(...f.weights)}..${Math.max(...f.weights)}` : `wght@${f.weights[0]}`;
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family).replace(/%20/g, "+")}:${spec}&display=block`;
    let css;
    try {
      css = await fetchText(cssUrl, fetchImpl);
    } catch {
      // not a variable family: ask for the discrete weights instead
      css = await fetchText(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family).replace(/%20/g, "+")}:wght@${f.weights.join(";")}&display=block`, fetchImpl);
    }
    const latin = [...css.matchAll(/\/\* latin \*\/\s*@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
    const block = latin[0] || (css.match(/@font-face\s*\{([^}]*)\}/) || [])[1];
    const url = block?.match(/url\((https:[^)]+)\)/)?.[1];
    if (!url) throw new Error(`no woff2 url for ${f.family}`);
    const res = await fetchImpl(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  }
  return out;
}

export function installedFonts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".woff2")).map((f) => join(dir, f));
}

export async function writeJson(file, data) {
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
  return file;
}
