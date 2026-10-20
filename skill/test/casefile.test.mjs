import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { campaignFromCasefile, casefileDuration, createCasefileCampaign, casefileEnabled, sourceLine } from "../scripts/casefile.mjs";
import { campaignRepetition, captionSentences } from "../scripts/lint.mjs";

// the template rotation state goes to a scratch home, not the real ~/.ziggy
const home = mkdtempSync(join(tmpdir(), "ziggy-casefile-"));
process.env.ZIGGY_HOME = home;
after(() => rmSync(home, { recursive: true, force: true }));

const TENANT = {
  slug: "alienwatch",
  name: "Alien Watch",
  site: "https://alienwatch.buzz/",
  language: "en",
  feed: { displayUrl: "alienwatch.buzz" },
  social: { 
    cta: "Full log of UAP observations → {url}",
    hashtags: "#UAP #UFO #AARO #Disclosure",
  },
  casefile: { enabled: true },
};

const CASEFILE_ITEM = {
  headline: "AARO found the records. It released none.",
  dek: "A FOIA reply tied to five cases on Rep. Luna's UAP list was withheld in full as classified.",
  points: [
    "Per a Pentagon letter dated 30 Sept 2026 (FOIA 26-F-1892), published by researcher John Greenewald, AARO located responsive records and withheld them under national-security exemptions.",
    "This answers a FOIA request, not Congress. It does not show the task force was denied the same files.",
    "The videos are public for most cited cases, but the written reports that explain them are not.",
  ],
  source: {
    outlet: "The Black Vault via Dark Files",
    url: "https://darkfires.org/aaro-foia-five-uap-cases-luna-september-2026/",
  },
  date: "2026-10-13",
  caseNum: "26-F-1892",
};

test("casefileDuration calculates duration based on point count", () => {
  // 7 + 3 * 4.5 + 4 = 24.5, rounded to 25
  assert.equal(casefileDuration(3), 25);
  assert.ok(casefileDuration(3) >= 15);
});

test("casefileEnabled checks tenant config", () => {
  assert.equal(casefileEnabled(TENANT), true);
  assert.equal(casefileEnabled({ slug: "other" }), false);
  assert.equal(casefileEnabled({ slug: "other", casefile: { enabled: false } }), false);
});

test("campaignFromCasefile builds a case file campaign with required structure", () => {
  const campaign = campaignFromCasefile(TENANT, CASEFILE_ITEM);
  
  // Template alternates between dossier and radar
  assert.ok(campaign.template === "casefile-dossier" || campaign.template === "casefile-radar");
  
  // Basic structure
  assert.equal(campaign.language, "en");
  assert.ok(campaign.duration >= 15);
  assert.match(campaign.intent, /Case File:/);
  
  // Casefile metadata
  assert.equal(campaign.casefile.source, CASEFILE_ITEM.source.url);
  assert.equal(campaign.casefile.outlet, CASEFILE_ITEM.source.outlet);
  assert.equal(campaign.casefile.date, "2026-10-13");
  
  // Copy
  assert.match(campaign.copy.kicker, /CASE FILE/);
  assert.equal(campaign.copy.headline, CASEFILE_ITEM.headline);
  assert.equal(campaign.copy.dek, CASEFILE_ITEM.dek);
  assert.equal(campaign.copy.points.length, 3);
  assert.equal(campaign.copy.points[0], CASEFILE_ITEM.points[0]);
  assert.equal(campaign.copy.url, "alienwatch.buzz");
  
  // Posts
  assert.equal(campaign.posts.instagram_reel.media, "reel");
  assert.ok(campaign.posts.instagram_reel.body.includes("✅ CONFIRMED:"));
  assert.ok(campaign.posts.instagram_reel.body.includes("❓ NOT CONFIRMED:"));
  assert.ok(campaign.posts.instagram_reel.body.includes("WHY IT MATTERS:"));
  assert.ok(campaign.posts.instagram_reel.body.includes(CASEFILE_ITEM.source.outlet));
  assert.ok(campaign.posts.instagram_reel.body.includes("alienwatch.buzz"));
  
  // X post disabled by default (opt in via social.platforms)
  assert.equal(campaign.posts.twitter.enabled, false);
});

test("campaignFromCasefile enables twitter when in social.platforms", () => {
  const tenantWithTwitter = {
    ...TENANT,
    social: { 
      ...TENANT.social,
      platforms: ["tiktok", "twitter"],
    },
  };
  const campaign = campaignFromCasefile(tenantWithTwitter, CASEFILE_ITEM);
  assert.equal(campaign.posts.twitter.enabled, true, "twitter should be enabled when in social.platforms");
  assert.equal(campaign.posts.twitter.media, "reel", "X posts the reel the round renders");
  assert.equal(campaign.posts.twitter.thread.at(-1).body.includes("alienwatch.buzz"), true, "thread should end with site link");
  assert.equal(campaign.posts.tiktok.enabled, true);
  assert.equal(campaign.posts.instagram_post.enabled, false, "instagram_post not in platforms");
});

test("campaignFromCasefile validates required points", () => {
  const invalidItem = { ...CASEFILE_ITEM, points: ["one", "two"] };
  assert.throws(() => campaignFromCasefile(TENANT, invalidItem), /requires exactly 3 points/);
});

test("campaignFromCasefile handles missing optional fields", () => {
  const minimalItem = {
    headline: "Test Headline",
    dek: "Test dek.",
    points: ["Confirmed fact", "Not confirmed fact", "Why it matters"],
    source: { outlet: "Test Source" },
  };
  
  const campaign = campaignFromCasefile(TENANT, minimalItem);
  assert.equal(campaign.copy.headline, "Test Headline");
  assert.equal(campaign.casefile.outlet, "Test Source");
  assert.equal(campaign.casefile.source, ""); // No URL provided
});

test("campaignFromCasefile uses tenant social settings", () => {
  const campaign = campaignFromCasefile(TENANT, CASEFILE_ITEM);
  assert.ok(campaign.posts.instagram_reel.body.includes("Full log of UAP observations"));
  assert.ok(campaign.posts.instagram_reel.body.includes("#UAP #UFO #AARO #Disclosure"));
});

test("campaignFromCasefile alternates between templates by date", () => {
  // Templates should alternate daily
  const campaign1 = campaignFromCasefile(TENANT, { ...CASEFILE_ITEM, date: "2026-10-01" });
  const campaign2 = campaignFromCasefile(TENANT, { ...CASEFILE_ITEM, date: "2026-10-02" });
  
  // Both should be valid template names
  assert.ok(["casefile-dossier", "casefile-radar"].includes(campaign1.template));
  assert.ok(["casefile-dossier", "casefile-radar"].includes(campaign2.template));
});

test("campaignFromCasefile can override template", () => {
  const campaign = campaignFromCasefile(TENANT, CASEFILE_ITEM, { template: "casefile-dossier" });
  assert.equal(campaign.template, "casefile-dossier");
  
  const campaign2 = campaignFromCasefile(TENANT, CASEFILE_ITEM, { template: "casefile-radar" });
  assert.equal(campaign2.template, "casefile-radar");
});

test("campaignFromCasefile strips point labels automatically", () => {
  const itemWithLabels = {
    ...CASEFILE_ITEM,
    points: [
      "Confirmed: This is the confirmed fact",
      "Not confirmed: This is not confirmed",
      "Why it matters: This is why it matters",
    ],
  };
  
  const campaign = campaignFromCasefile(TENANT, itemWithLabels);
  assert.equal(campaign.copy.points[0], "This is the confirmed fact");
  assert.equal(campaign.copy.points[1], "This is not confirmed");
  assert.equal(campaign.copy.points[2], "This is why it matters");
});

test("campaignFromCasefile strips point labels with emoji", () => {
  const itemWithEmoji = {
    ...CASEFILE_ITEM,
    points: [
      "✅ Confirmed: This is confirmed",
      "❓ Not confirmed: This is not confirmed",
      "• Why it matters: This is important",
    ],
  };
  
  const campaign = campaignFromCasefile(TENANT, itemWithEmoji);
  assert.equal(campaign.copy.points[0], "This is confirmed");
  assert.equal(campaign.copy.points[1], "This is not confirmed");
  assert.equal(campaign.copy.points[2], "This is important");
});

test("campaignFromCasefile accepts status field", () => {
  const itemWithStatus = { ...CASEFILE_ITEM, status: "released" };
  const campaign = campaignFromCasefile(TENANT, itemWithStatus);
  assert.equal(campaign.casefile.status, "released");
});

test("campaignFromCasefile defaults status to withheld", () => {
  const campaign = campaignFromCasefile(TENANT, CASEFILE_ITEM);
  assert.equal(campaign.casefile.status, "withheld");
});

test("campaignFromCasefile accepts template from item", () => {
  const itemWithTemplate = { ...CASEFILE_ITEM, template: "casefile-radar" };
  const campaign = campaignFromCasefile(TENANT, itemWithTemplate);
  assert.equal(campaign.template, "casefile-radar");
});

test("campaignFromCasefile accepts custom stamp text", () => {
  const itemWithStamp = { ...CASEFILE_ITEM, stamp: "CLASSIFIED", stampSub: "top secret" };
  const campaign = campaignFromCasefile(TENANT, itemWithStamp);
  assert.equal(campaign.casefile.stamp, "CLASSIFIED");
  assert.equal(campaign.casefile.stampSub, "top secret");
});

test("campaignFromCasefile has empty stamp by default", () => {
  const campaign = campaignFromCasefile(TENANT, CASEFILE_ITEM);
  assert.equal(campaign.casefile.stamp, "");
  assert.equal(campaign.casefile.stampSub, "");
});

test("campaignFromCasefile accepts at field for scheduling", () => {
  const itemWithAt = { ...CASEFILE_ITEM, at: "2026-10-14T15:00:00.000Z" };
  const campaign = campaignFromCasefile(TENANT, itemWithAt);
  assert.equal(campaign.at, "2026-10-14T15:00:00.000Z");
});

test("campaignFromCasefile has null at by default", () => {
  const campaign = campaignFromCasefile(TENANT, CASEFILE_ITEM);
  assert.equal(campaign.at, null);
});

test("casefile dossier stamp CSS uses fully opaque colors for contrast compliance", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { dirname } = await import("node:path");
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const templatePath = join(__dirname, "..", "templates", "hyperframes", "casefile-dossier", "sub.html.tpl");
  
  const template = readFileSync(templatePath, "utf8");
  
  // Verify stamp uses rgb() not rgba() for text colors
  assert.ok(template.includes("#__ID__-stamp-main") && template.includes("color: rgb("), 
    "Stamp main text should use rgb() color");
  assert.ok(template.includes("#__ID__-stamp-sub") && template.includes("color: rgb("), 
    "Stamp sub text should use rgb() color");
  
  // Verify no semi-transparent text colors (rgba with alpha < 1)
  const rgbaPattern = /color:\s*rgba\([^)]+,\s*0\.\d+\)/g;
  const stampSection = template.substring(
    template.indexOf("/* withheld stamp"),
    template.indexOf("/* source footer")
  );
  const transparentColors = stampSection.match(rgbaPattern);
  assert.ok(!transparentColors || transparentColors.length === 0,
    "Stamp text should not use semi-transparent colors (rgba with alpha < 1)");
  
  // Verify stamp animation uses opacity: 1
  assert.ok(template.includes("opacity: 1") && template.includes("/* stamp slams on - fully opaque"),
    "Stamp animation should set opacity to 1 for contrast compliance");
});

test("campaignFromCasefile accepts custom labels array", () => {
  const item = {
    ...CASEFILE_ITEM,
    labels: ["VERIFIED", "DISPUTED", "IMPLICATIONS"],
  };
  
  const campaign = campaignFromCasefile(TENANT, item);
  
  assert.ok(campaign.casefile.labels, "campaign should have labels");
  assert.deepEqual(campaign.casefile.labels, ["VERIFIED", "DISPUTED", "IMPLICATIONS"]);
  
  // Caption should use custom labels
  const caption = campaign.posts.instagram_reel.body;
  assert.ok(caption.includes("✅ VERIFIED:"), "caption should use first custom label");
  assert.ok(caption.includes("❓ DISPUTED:"), "caption should use second custom label");
  assert.ok(caption.includes("IMPLICATIONS:"), "caption should use third custom label");
});

test("campaignFromCasefile accepts per-point objects with labels", () => {
  const item = {
    headline: "Custom point format test",
    dek: "Testing objects with labels",
    points: [
      { label: "OBSERVATION", text: "UAP observed by multiple sensors" },
      { label: "ANALYSIS", text: "Data shows anomalous behavior" },
      { label: "IMPACT", text: "Requires further investigation" },
    ],
    source: { outlet: "Test", url: "https://example.com" },
  };
  
  const campaign = campaignFromCasefile(TENANT, item);
  
  assert.deepEqual(campaign.casefile.labels, ["OBSERVATION", "ANALYSIS", "IMPACT"]);
  assert.deepEqual(campaign.copy.points, [
    "UAP observed by multiple sensors",
    "Data shows anomalous behavior",
    "Requires further investigation",
  ]);
  
  const caption = campaign.posts.instagram_reel.body;
  assert.ok(caption.includes("✅ OBSERVATION:"), "caption should use first label from object");
  assert.ok(caption.includes("❓ ANALYSIS:"), "caption should use second label from object");
  assert.ok(caption.includes("IMPACT:"), "caption should use third label from object");
});

test("campaignFromCasefile falls back to defaults when no labels provided", () => {
  const campaign = campaignFromCasefile(TENANT, CASEFILE_ITEM);
  
  assert.deepEqual(campaign.casefile.labels, ["CONFIRMED", "NOT CONFIRMED", "WHY IT MATTERS"]);
  
  const caption = campaign.posts.instagram_reel.body;
  assert.ok(caption.includes("✅ CONFIRMED:"), "caption should use default first label");
  assert.ok(caption.includes("❓ NOT CONFIRMED:"), "caption should use default second label");
  assert.ok(caption.includes("WHY IT MATTERS:"), "caption should use default third label");
});

test("campaignFromCasefile handles partial labels in point objects", () => {
  const item = {
    headline: "Partial labels test",
    dek: "Some points have labels, some don't",
    points: [
      { label: "CUSTOM1", text: "First point" },
      { text: "Second point without label" },
      { label: "CUSTOM3", text: "Third point" },
    ],
    source: { outlet: "Test", url: "https://example.com" },
  };
  
  const campaign = campaignFromCasefile(TENANT, item);
  
  // Should use custom labels where provided, defaults where missing
  assert.equal(campaign.casefile.labels[0], "CUSTOM1");
  assert.equal(campaign.casefile.labels[1], "NOT CONFIRMED"); // default
  assert.equal(campaign.casefile.labels[2], "CUSTOM3");
});

// ── Optional per-item link ───────────────────────────────────────────────────────────────────
// casefile-golden-nolink.json was generated from main (dc6de6d) before `link` existed: without a
// link the campaign must stay byte-identical, with a custom CTA and with the default one.
const GOLDEN_TENANT = { slug: "alienwatch", name: "Alien Watch", site: "https://alienwatch.buzz/", language: "en",
  feed: { displayUrl: "alienwatch.buzz" }, social: { cta: "Full log of UAP observations → {url}", hashtags: "#UAP #UFO #AARO #Disclosure", platforms: ["tiktok", "twitter"] }, casefile: { enabled: true } };
const GOLDEN_ITEM = { headline: "AARO found the records. It released none.", dek: "A FOIA reply tied to five cases on Rep. Luna's UAP list was withheld in full as classified.",
  points: ["AARO located responsive records and withheld them.", "This answers a FOIA request, not Congress.", "The written reports are not public."],
  labels: ["THE REPLY", "THE LIMIT", "THE GAP"], source: { outlet: "The Black Vault", url: "https://example.org/foia" },
  status: "withheld", template: "casefile-dossier", date: "2026-10-13", at: "2026-10-20T05:00:00Z",
  image: "https://example.org/page.png", imageCredit: "Document: example (public domain)" };
const GOLDEN_DEFAULT_TENANT = { ...GOLDEN_TENANT, social: { platforms: ["twitter"] } };
const GOLDEN = JSON.parse(readFileSync(new URL("./fixtures/casefile-golden-nolink.json", import.meta.url), "utf8"));
const LINK = "https://alienwatch.buzz/dossier/pursue";

test("campaignFromCasefile without link is byte-identical to the pre-link output", () => {
  assert.equal(JSON.stringify(campaignFromCasefile(GOLDEN_TENANT, GOLDEN_ITEM), null, 2), JSON.stringify(GOLDEN.custom, null, 2));
  assert.equal(JSON.stringify(campaignFromCasefile(GOLDEN_DEFAULT_TENANT, GOLDEN_ITEM), null, 2), JSON.stringify(GOLDEN.defaultCta, null, 2));
});

test("campaignFromCasefile with link uses it in the caption CTA and the X thread's last reply", () => {
  const c = campaignFromCasefile(GOLDEN_TENANT, { ...GOLDEN_ITEM, link: LINK });
  for (const k of ["instagram_reel", "instagram_post", "tiktok", "facebook_reel"]) {
    assert.ok(c.posts[k].body.includes(`\n\nFull log of UAP observations → ${LINK}\n\n#UAP`), k);
  }
  assert.deepEqual(c.posts.twitter.thread.at(-1), { body: LINK });
  // only those two places change
  const strip = (x) => JSON.parse(JSON.stringify(x).replaceAll(`→ ${LINK}`, "→ alienwatch.buzz").replaceAll(`"body":"${LINK}"`, '"body":"https://alienwatch.buzz"'));
  assert.deepEqual(strip(c), GOLDEN.custom);
});

test("campaignFromCasefile with link and the default tenant CTA", () => {
  const c = campaignFromCasefile(GOLDEN_DEFAULT_TENANT, { ...GOLDEN_ITEM, link: LINK });
  assert.ok(c.posts.tiktok.body.includes(`Full story with sources: ${LINK}`));
  assert.equal(c.posts.twitter.thread.at(-1).body, LINK);
});

test("campaignFromCasefile trims the link and rejects non-https links", () => {
  assert.equal(campaignFromCasefile(GOLDEN_TENANT, { ...GOLDEN_ITEM, link: `  ${LINK} ` }).posts.twitter.thread.at(-1).body, LINK);
  for (const bad of ["http://alienwatch.buzz/dossier/pursue", "alienwatch.buzz/dossier", "", "https://", "javascript:alert(1)", 42]) {
    assert.throws(() => campaignFromCasefile(GOLDEN_TENANT, { ...GOLDEN_ITEM, link: bad }), /link must be an https URL/, String(bad));
  }
});

// ── Photo credit position (case file layouts) ────────────────────────────────────────────────
// Renders of 18 Oct failed the layout audit: on radar the credit sat under the bottom corner
// tapes; on dossier a tall photo pushed the credit onto the source line.
const tpl = (name) => readFileSync(new URL(`../templates/hyperframes/${name}/sub.html.tpl`, import.meta.url), "utf8");
const rule = (css, sel) => (css.match(new RegExp(`#__ID__-${sel} \\{([^}]*)\\}`)) || [])[1] || "";
const px = (decl, prop) => { const m = decl.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`)); return m ? m[1].trim() : null; };

test("radar photo credit clears the bottom corner tapes", () => {
  const css = tpl("casefile-radar");
  const credit = rule(css, "photo-credit");
  const [, side] = px(credit, "margin").split(/\s+/).map((v) => parseFloat(v));
  for (const id of ["tape3", "tape4"]) {
    const tape = rule(css, id);
    const w = parseFloat(px(tape, "width")), h = parseFloat(px(tape, "height"));
    const inset = Math.abs(parseFloat(px(tape, id === "tape3" ? "left" : "right")));
    const deg = Math.abs(parseFloat(px(tape, "transform").match(/rotate\((-?[\d.]+)deg\)/)[1])) * Math.PI / 180;
    // horizontal reach of the rotated strip into the border, measured from its edge
    const reach = (w - inset) / 2 + (w * Math.cos(deg) + h * Math.sin(deg)) / 2;
    assert.ok(side > reach, `${id}: credit side margin ${side}px must exceed the tape's reach ${reach.toFixed(1)}px`);
  }
  assert.ok(Number(px(credit, "z-index")) > Number(px(css.match(/\.tape \{([^}]*)\}/)[1], "z-index")), "credit above the tapes");
});

test("dossier template shrinks the photo until its credit clears the source line and the stamp", () => {
  const html = tpl("casefile-dossier");
  assert.match(html, /function fitPhoto\(\)/);
  assert.match(html, /\[\$\("source"\), \$\("stamp"\)\]/);
  assert.match(html, /function build\(\) \{\s*if \(window\.__timelines\[ID\]\) \{[^}]*\}\s*fitPhoto\(\);/);
  // measured only once the photo is loaded, and never below a readable size
  assert.match(html, /addEventListener\("load", build/);
  assert.match(html, /h > 140/);
});

// ── Source line and caption lint ─────────────────────────────────────────────────────────────
// A real dossier caption read "Source: PURSUE, war.gov/UFO · war.gov": the URL repeated the outlet.
const PURSUE = {
  headline: "The Pentagon put its UFO files online",
  dek: "PURSUE, the Department of War's records portal, opened with 46 case documents and 12 videos.",
  labels: ["THE CLAIM", "THE CHECK", "THE ANSWER"],
  points: ["Officials call it the largest UAP release yet.", "Most files were already public through FOIA.", "New: three range-fouler reports from 2021."],
  source: { outlet: "PURSUE, war.gov/UFO", url: "war.gov" },
  template: "casefile-dossier", date: "2026-10-16",
};

test("source line: the URL is dropped when the outlet already names it", () => {
  assert.equal(sourceLine("PURSUE, war.gov/UFO", "war.gov"), "Source: PURSUE, war.gov/UFO");
  assert.equal(sourceLine("PURSUE, war.gov/UFO", "https://www.war.gov/"), "Source: PURSUE, war.gov/UFO");
  assert.equal(sourceLine("PURSUE, war.gov/UFO", "https://war.gov/UFO"), "Source: PURSUE, war.gov/UFO");
  // a URL the outlet does not name stays: it points to the document
  assert.equal(sourceLine("The Black Vault", "https://example.org/foia"), "Source: The Black Vault · https://example.org/foia");
  assert.equal(sourceLine("war.gov", "https://www.war.gov/UFO/"), "Source: war.gov · https://www.war.gov/UFO/");
  assert.equal(sourceLine("Notes on war.gov", "https://ar.gov"), "Source: Notes on war.gov · https://ar.gov", "a host inside another host is a different host");
  assert.equal(sourceLine("Test Source", ""), "Source: Test Source");
  const body = campaignFromCasefile(TENANT, PURSUE).posts.instagram_reel.body;
  assert.match(body, /\n\nTHE ANSWER: New: three range-fouler reports from 2021\.\n\nSource: PURSUE, war\.gov\/UFO\n\nFull log of UAP observations → alienwatch\.buzz\n\n/);
  assert.doesNotMatch(body, /· war\.gov/);
});

test("case file lint: headline, dek and each point add a fact; labels and the source line are not compared", () => {
  const c = campaignFromCasefile(TENANT, PURSUE);
  assert.deepEqual(campaignRepetition(c), { ok: true, pairs: [] });
  // what the lint reads: the dek, the points without their labels, no source line
  assert.deepEqual(captionSentences(c.posts.instagram_reel.body, PURSUE.headline, { labels: c.casefile.labels }).slice(0, 4), [PURSUE.dek, ...PURSUE.points]);
  // a source named like the headline (a press release title) is not a repetition
  const release = campaignFromCasefile(TENANT, { ...PURSUE, source: { outlet: "Department of War: The Pentagon put its UFO files online", url: "https://www.war.gov/UFO/" } });
  assert.equal(campaignRepetition(release).ok, true);
  const refused = (item) => campaignRepetition(campaignFromCasefile(TENANT, { ...PURSUE, ...item }));
  // the dek restates the headline
  let r = refused({ dek: "The Pentagon has put its UFO files online on a new portal." });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'caption repeats itself: "The Pentagon put its UFO files online" ~ "The Pentagon has put its UFO files online on a new portal."');
  // a point restates the headline
  r = refused({ points: ["The Pentagon put its UFO files online this week.", PURSUE.points[1], PURSUE.points[2]] });
  assert.deepEqual(r.pairs.map((p) => [p.a, p.b, p.score]), [[PURSUE.headline, "The Pentagon put its UFO files online this week.", 1]]);
  // two points say the same thing
  r = refused({ points: [PURSUE.points[0], "Most files were already public through FOIA requests.", "Most of the files were already public through FOIA."] });
  assert.deepEqual(r.pairs.map((p) => [p.a, p.b]), [["Most files were already public through FOIA requests.", "Most of the files were already public through FOIA."]]);
  // a point retells the dek
  r = refused({ points: ["The records portal opened with 46 case documents and 12 videos.", PURSUE.points[1], PURSUE.points[2]] });
  assert.equal(r.pairs[0].a, PURSUE.dek);
  // the examples the docs and the tests use all pass
  for (const item of [CASEFILE_ITEM, GOLDEN_ITEM]) assert.equal(campaignRepetition(campaignFromCasefile(TENANT, item)).ok, true, item.headline);
});
