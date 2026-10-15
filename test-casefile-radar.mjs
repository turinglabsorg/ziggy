#!/usr/bin/env node
/**
 * Test script to generate test case file radar campaigns.
 */

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const { createCasefileCampaign } = await import("./skill/scripts/casefile.mjs");
const { loadTenant } = await import("./skill/scripts/config.mjs");
const { scaffold, DEFAULT_VARIANTS, TEMPLATE_VARIANTS } = await import("./skill/scripts/video.mjs");

const tenant = loadTenant("alienwatch");

// Test data with photo
const testDataWithPhoto = {
  headline: "NORAD tracks unknown object over Alaska",
  dek: "North American Aerospace Defense Command confirms radar contact with unidentified aircraft.",
  points: [
    {
      label: "DETECTION",
      text: "Multiple radar systems tracked object at 40,000 feet moving at unprecedented speed."
    },
    {
      label: "RESPONSE",
      text: "F-22 interceptors scrambled from Joint Base Elmendorf-Richardson. No visual contact made."
    },
    {
      label: "STATUS",
      text: "Object disappeared from radar. Investigation ongoing. No threat assessment issued."
    }
  ],
  source: {
    outlet: "NORAD",
    url: "norad.mil"
  },
  status: "active",
  template: "casefile-radar",
  image: "https://upload.wikimedia.org/wikipedia/commons/4/44/David_Grusch_giving_testimony_on_26_July_2023_before_the_US_House_Subcommittee_on_National_Security_the_Border_and_Foreign_Affairs.png",
  imageCredit: "USAF / Public Domain",
  caseNum: "NORAD-2026-1015"
};

// Test data without photo
const testDataNoPhoto = {
  headline: "Pentagon releases UAP incident report",
  dek: "Department of Defense publishes findings from 2023 aerial phenomena investigations.",
  points: [
    {
      label: "INCIDENTS",
      text: "144 unexplained sightings documented by military personnel between 2004 and 2023."
    },
    {
      label: "ANALYSIS",
      text: "Most incidents remain unexplained. No evidence of extraterrestrial technology found."
    },
    {
      label: "ONGOING",
      text: "Permanent UAP investigation office established. Future reports expected quarterly."
    }
  ],
  source: {
    outlet: "DoD",
    url: "defense.gov"
  },
  status: "resolved",
  template: "casefile-radar",
  caseNum: "UAP-RPT-2023"
};

console.log("Creating radar test campaigns...\n");

const withPhoto = await createCasefileCampaign(tenant, testDataWithPhoto, { 
  name: "test-radar-with-photo",
  force: true 
});
console.log(`1. Radar WITH photo: ${withPhoto.name}`);

const noPhoto = await createCasefileCampaign(tenant, testDataNoPhoto, { 
  name: "test-radar-no-photo",
  force: true 
});
console.log(`2. Radar WITHOUT photo: ${noPhoto.name}`);

console.log("\n\nScaffolding radar projects...\n");

for (const result of [withPhoto, noPhoto]) {
  console.log(`Scaffolding ${result.name}...`);
  const { loadCampaign } = await import("./skill/scripts/config.mjs");
  const campaign = loadCampaign(tenant.slug, result.name);
  const variants = ["reel"];
  const variantConfigs = {};
  for (const v of variants) {
    const base = DEFAULT_VARIANTS[v];
    const overlay = TEMPLATE_VARIANTS[campaign.template]?.[v];
    if (overlay === false) continue;
    variantConfigs[v] = { ...base, ...overlay };
  }
  await scaffold({ 
    tenant, 
    campaign: { name: result.name, ...campaign }, 
    variants: variantConfigs
  });
}

console.log("\n✅ Radar test campaigns created and scaffolded!");
