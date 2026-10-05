import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { assignPalette, brandFromSources, normalizeHex, parseGoogleFontsUrl, parseRootVars, parseWordmark, resolveVar, extractBrand } from "../scripts/brand.mjs";

const FIX = join(import.meta.dirname, "fixtures");
const html = readFileSync(join(FIX, "alienwatch.html"), "utf8");
const css = readFileSync(join(FIX, "alienwatch.css"), "utf8");

test("CSS variables, var() resolution and hex normalisation", () => {
  const vars = parseRootVars(":root{--a:#fff; --b: var(--a); --c: rgb(255, 90, 31)} :root { --d: #07080b }");
  assert.equal(vars["--a"], "#fff");
  assert.equal(resolveVar("var(--b)", vars), "#fff");
  assert.equal(normalizeHex(vars["--c"]), "#ff5a1f");
  assert.equal(normalizeHex("#fff"), "#ffffff");
  assert.equal(normalizeHex("red"), null);
  assert.equal(vars["--d"], "#07080b");
});

test("palette roles: darkest is bg, lightest fg, most saturated accent", () => {
  const p = assignPalette(["#07080b", "#ece6da", "#8c8678", "#24231f", "#ff5a1f"]);
  assert.equal(p.bg, "#07080b");
  assert.equal(p.fg, "#ece6da");
  assert.equal(p.accent, "#ff5a1f");
  assert.ok(["#24231f", "#8c8678"].includes(p.line));
});

test("Google Fonts URL → families and weights", () => {
  const fams = parseGoogleFontsUrl("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Unbounded:wght@300;600&display=swap");
  assert.deepEqual(fams, [{ family: "Geist Mono", weights: [400, 500] }, { family: "Unbounded", weights: [300, 600] }]);
});

test("wordmark parts with light/heavy weights from <b>", () => {
  const wm = parseWordmark('<a class="wordmark" href="#/">Alien<b>Watch</b><span class="moon" aria-hidden="true"></span></a>');
  assert.deepEqual(wm, { text: "Alien Watch", parts: [{ text: "Alien", weight: 300 }, { text: "Watch", weight: 600 }] });
});

test("brandFromSources on the alienwatch fixture", () => {
  const b = brandFromSources({ site: "https://alienwatch.buzz/", html, css });
  assert.equal(b.name, "Alien Watch");
  assert.equal(b.palette.bg, "#07080b");
  assert.equal(b.palette.fg, "#ece6da");
  assert.equal(b.palette.accent, "#ff5a1f");
  assert.equal(b.palette.line, "#24231f");
  assert.equal(b.palette.muted, "#8c8678");
  assert.equal(b.fonts.display.family, "Unbounded");
  assert.equal(b.fonts.text.family, "Geist");
  assert.equal(b.fonts.mono.family, "Geist Mono");
  assert.equal(b.wordmark.transform, "uppercase");
  assert.equal(b.wordmark.letterSpacing, "0.06em");
  assert.equal(b.wordmark.accentDot, true);
  assert.match(b.mark.svg, /<svg/);
  assert.equal(b.mark.source, "favicon-data-uri");
  assert.equal(b.stars, true);
  assert.match(b.tagline, /^Osservazioni/);
});

test("extractBrand fetches the page and its first-party stylesheets only", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    if (String(url).endsWith("/")) return new Response(html, { status: 200 });
    if (String(url).includes("styles.css")) return new Response(css, { status: 200 });
    return new Response("nope", { status: 404 });
  };
  const b = await extractBrand("https://alienwatch.buzz", { fetchImpl });
  assert.equal(b.palette.accent, "#ff5a1f");
  assert.ok(seen.some((u) => u.includes("styles.css")));
  assert.ok(!seen.some((u) => u.includes("fonts.googleapis")), "Google Fonts CSS is parsed from the link, not fetched");
});
