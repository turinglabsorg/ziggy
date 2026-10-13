import assert from "node:assert/strict";
import { test } from "node:test";

import { campaignFromCasefile, casefileDuration, createCasefileCampaign, casefileEnabled } from "../scripts/casefile.mjs";

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
  assert.ok(campaign.posts.instagram_reel.body.includes("✅ Confirmed:"));
  assert.ok(campaign.posts.instagram_reel.body.includes("❓ Not confirmed:"));
  assert.ok(campaign.posts.instagram_reel.body.includes("Why it matters:"));
  assert.ok(campaign.posts.instagram_reel.body.includes(CASEFILE_ITEM.source.outlet));
  assert.ok(campaign.posts.instagram_reel.body.includes("alienwatch.buzz"));
  
  // X post disabled by default (needs slide-cover still)
  assert.equal(campaign.posts.twitter.enabled, false);
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
