#!/usr/bin/env node
/**
 * Test script to generate test case file dossier campaigns.
 * Usage: node test-casefile-dossier.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Import the required functions
const { createCasefileCampaign } = await import("./skill/scripts/casefile.mjs");
const { loadTenant } = await import("./skill/scripts/config.mjs");
const { scaffold } = await import("./skill/scripts/video.mjs");

// Load tenant (which includes brand)
const tenant = loadTenant("alienwatch");

// Test data from user's JSON
const testDataWithPhoto = {
  headline: "Grusch on Rogan: the claims vs. the record",
  dek: "On Joe Rogan #2560 (30 Sept), Grusch described a deadly UFO crash clash. No evidence shown.",
  points: [
    {
      label: "WHAT HE SAID",
      text: "He said reptilian beings killed US personnel at a UFO crash site, then were shot."
    },
    {
      label: "SECONDHAND",
      text: "He says he never saw them. Under oath in 2023: 'never seen anything personally.'"
    },
    {
      label: "NO EVIDENCE",
      text: "AARO's 2024 review found no verifiable evidence of recovered alien technology."
    }
  ],
  source: {
    outlet: "AARO · House Oversight",
    url: "aaro.mil"
  },
  status: "unverified",
  template: "casefile-dossier",
  image: "https://upload.wikimedia.org/wikipedia/commons/4/44/David_Grusch_giving_testimony_on_26_July_2023_before_the_US_House_Subcommittee_on_National_Security_the_Border_and_Foreign_Affairs.png",
  imageCredit: "Wikimedia Commons",
  at: "2026-10-15T07:54:00Z"
};

// Test data without photo
const testDataNoPhoto = {
  headline: "Grusch testimony: key claims remain unverified",
  dek: "Three key claims from David Grusch's testimony to Congress remain without public evidence.",
  points: [
    {
      label: "CLAIM",
      text: "Grusch stated the US has recovered 'non-human origin technical vehicles' since 1945."
    },
    {
      label: "VERIFICATION",
      text: "AARO's 2024 report: 'no verifiable information' of extraterrestrial materials."
    },
    {
      label: "STATUS",
      text: "Congress continues investigation. No physical evidence has been presented publicly."
    }
  ],
  source: {
    outlet: "AARO",
    url: "aaro.mil"
  },
  status: "unverified",
  template: "casefile-dossier"
};

// Long headline test
const testDataLongHeadline = {
  headline: "Pentagon official confirms unexplained aerial phenomena tracked over multiple military installations worldwide",
  dek: "Department of Defense spokesperson acknowledges ongoing monitoring of unidentified objects.",
  points: [
    {
      label: "CONFIRMED",
      text: "Multiple radar systems tracked objects exhibiting flight characteristics beyond known technology."
    },
    {
      label: "INVESTIGATION",
      text: "All-domain Anomaly Resolution Office established to investigate these incidents systematically."
    },
    {
      label: "SIGNIFICANCE",
      text: "First official acknowledgment of advanced technology of potentially non-human origin operating in restricted airspace."
    }
  ],
  source: {
    outlet: "DoD Press Office",
    url: "defense.gov"
  },
  status: "withheld",
  stamp: "WITHHELD",
  stampSub: "5 U.S.C. § 552(b)(1)",
  template: "casefile-dossier",
  image: "https://upload.wikimedia.org/wikipedia/commons/4/44/David_Grusch_giving_testimony_on_26_July_2023_before_the_US_House_Subcommittee_on_National_Security_the_Border_and_Foreign_Affairs.png",
  imageCredit: "Wikimedia Commons"
};

console.log("Creating test campaigns...\n");

// Create campaign with photo
console.log("1. Campaign WITH photo:");
const withPhoto = await createCasefileCampaign(tenant, testDataWithPhoto, { 
  name: "test-with-photo",
  force: true 
});
console.log(`   Created: ${withPhoto.name}`);
console.log(`   Dir: ${withPhoto.dir}`);

// Create campaign without photo
console.log("\n2. Campaign WITHOUT photo:");
const noPhoto = await createCasefileCampaign(tenant, testDataNoPhoto, { 
  name: "test-no-photo",
  force: true 
});
console.log(`   Created: ${noPhoto.name}`);
console.log(`   Dir: ${noPhoto.dir}`);

// Create campaign with long headline
console.log("\n3. Campaign with LONG headline and photo:");
const longHead = await createCasefileCampaign(tenant, testDataLongHeadline, { 
  name: "test-long-headline",
  force: true 
});
console.log(`   Created: ${longHead.name}`);
console.log(`   Dir: ${longHead.dir}`);

console.log("\n\nScaffolding projects...\n");

// Scaffold all three - campaigns already saved, now scaffold the HyperFrames projects
for (const result of [withPhoto, noPhoto, longHead]) {
  console.log(`Scaffolding ${result.name}...`);
  const { loadCampaign } = await import("./skill/scripts/config.mjs");
  const campaign = loadCampaign(tenant.slug, result.name);
  const variants = ["reel"];
  const variantConfigs = {};
  for (const v of variants) {
    const base = await import("./skill/scripts/video.mjs").then(m => m.DEFAULT_VARIANTS[v]);
    const overlay = await import("./skill/scripts/video.mjs").then(m => m.TEMPLATE_VARIANTS[campaign.template]?.[v]);
    if (overlay === false) continue;
    variantConfigs[v] = { ...base, ...overlay };
  }
  await scaffold({ 
    tenant, 
    campaign: { name: result.name, ...campaign }, 
    variants: variantConfigs
  });
}

console.log("\n✅ Test campaigns created and scaffolded!");
console.log("\nTo preview:");
console.log(`  cd ~/.ziggy/tenants/alienwatch/videos/${withPhoto.name}/reel`);
console.log(`  npx hyperframes preview`);
console.log("\nTo render covers:");
console.log(`  node skill/index.js video alienwatch test-with-photo`);
console.log(`  node skill/index.js video alienwatch test-no-photo`);
console.log(`  node skill/index.js video alienwatch test-long-headline`);
