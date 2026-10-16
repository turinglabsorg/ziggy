#!/usr/bin/env node
/**
 * Analyze real Ragusa feed data to show before/after dedupe behavior
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Old implementation
function titleTokensOld(title) {
  return new Set(slugify(title).split("-").filter((w) => w.length > 2 && !/^[0-9a-f]{6,}$/.test(w)));
}

function storyCoveredOld(story, covered) {
  const bare = String(story.slug || "").replace(/(?:-[0-9a-f]{6,})+$/, "");
  const tokens = titleTokensOld(story.title || "");
  for (const c of covered) {
    if (c.slug && bare === String(c.slug).replace(/(?:-[0-9a-f]{6,})+$/, "")) return true;
    if (!tokens.size || !c.tokens.size) continue;
    let hit = 0;
    for (const w of tokens) if (c.tokens.has(w)) hit++;
    if (hit / tokens.size >= 0.25) return true;
  }
  return false;
}

// New implementation
const IT_STOPWORDS = new Set([
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
  "di", "a", "da", "in", "con", "su", "per", "tra", "fra", "del", "dei", "della", "delle", "dello", "degli", "al", "ai", "alla", "alle", "allo", "agli", "dal", "dai", "dalla", "dalle", "dallo", "dagli", "nel", "nei", "nella", "nelle", "nello", "negli", "sul", "sui", "sulla", "sulle", "sullo", "sugli", "col", "coi", "colla", "colle",
  "e", "ed", "o", "od", "ma", "se", "che",
  "è", "ha", "ho", "hai", "non", "più", "anche", "come", "chi", "cui",
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "for", "on", "at", "by", "with", "from", "as", "is", "was", "are", "be", "has", "had", "have",
]);

function storyIdFromSlug(slug) {
  if (!slug) return null;
  const match = String(slug).match(/[0-9a-f]{8,}-[0-9a-f]{8,}$/);
  return match ? match[0].split("-")[0] : null;
}

function titleTokensNew(title, placeNames = []) {
  const tokens = slugify(title).split("-");
  const places = new Set(placeNames.map((p) => slugify(String(p))));
  return new Set(tokens.filter((w) => 
    w.length > 3 && 
    !/^[0-9a-f]{6,}$/.test(w) && 
    !/^\d+$/.test(w) && 
    !IT_STOPWORDS.has(w) && 
    !places.has(w)
  ));
}

function storyCoveredNew(story, covered, placeNames = []) {
  const storyId = storyIdFromSlug(story.slug);
  const bare = String(story.slug || "").replace(/(?:-[0-9a-f]{6,})+$/, "");
  const tokens = titleTokensNew(story.title || "", placeNames);
  
  for (const c of covered) {
    if (storyId && c.storyId && storyId === c.storyId) return true;
    if (c.slug && bare === String(c.slug).replace(/(?:-[0-9a-f]{6,})+$/, "")) return true;
    if (!tokens.size || !c.tokens.size) continue;
    let hit = 0;
    for (const w of tokens) if (c.tokens.has(w)) hit++;
    if (hit >= 3 && hit / tokens.size >= 0.6) return true;
  }
  return false;
}

function slugify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);
}

async function main() {
  const placeNames = ["Ragusa", "Modica", "Comiso", "Scicli", "Vittoria", "Acate", "Ispica", "Pozzallo", "Santa Croce Camerina", "Giarratana", "Monterosso Almo", "Chiaramonte Gulfi"];
  
  console.log("Fetching real Ragusa feed data...\n");
  const res = await fetch("https://ragusa.buzz/feed/v1/briefings?lang=it&limit=50");
  const body = await res.json();
  const stories = body.data;
  
  console.log(`Total stories in feed: ${stories.length}\n`);
  
  // Simulate coverage: use the first 5 stories as "covered"
  const covered = stories.slice(0, 5).map((s) => ({
    slug: s.slug,
    storyId: storyIdFromSlug(s.slug),
    tokens: titleTokensNew(s.title, placeNames)
  }));
  
  console.log("=== COVERED STORIES (simulating already published) ===");
  covered.forEach((c, i) => {
    console.log(`${i + 1}. ${stories[i].title}`);
    console.log(`   Slug: ${c.slug}`);
    console.log(`   Story ID: ${c.storyId}`);
    console.log(`   Tokens: ${Array.from(c.tokens).join(", ")}`);
    console.log();
  });
  
  // Test remaining stories
  const remaining = stories.slice(5);
  
  console.log("\n=== OLD LOGIC (25% threshold, no stopwords) ===");
  const coveredOld = covered.map((c) => ({ slug: c.slug, tokens: titleTokensOld(stories[covered.indexOf(c)].title) }));
  let oldCoveredCount = 0;
  remaining.forEach((s, i) => {
    const isCovered = storyCoveredOld(s, coveredOld);
    if (isCovered) {
      oldCoveredCount++;
      console.log(`✗ BLOCKED: ${s.title}`);
      console.log(`   Slug: ${s.slug}`);
      const tokens = titleTokensOld(s.title);
      console.log(`   Tokens: ${Array.from(tokens).join(", ")}`);
      // Find which story blocked it
      for (const c of coveredOld) {
        let hit = 0;
        for (const w of tokens) if (c.tokens.has(w)) hit++;
        if (hit / tokens.size >= 0.25) {
          const idx = coveredOld.indexOf(c);
          console.log(`   Blocked by: ${stories[idx].title}`);
          console.log(`   Shared tokens: ${Array.from(tokens).filter(w => c.tokens.has(w)).join(", ")} (${hit}/${tokens.size} = ${(hit / tokens.size * 100).toFixed(0)}%)`);
          break;
        }
      }
      console.log();
    }
  });
  console.log(`Total blocked by old logic: ${oldCoveredCount} / ${remaining.length}`);
  
  console.log("\n=== NEW LOGIC (60% threshold, stopwords filtered, story ID primary) ===");
  let newCoveredCount = 0;
  remaining.forEach((s) => {
    const isCovered = storyCoveredNew(s, covered, placeNames);
    if (isCovered) {
      newCoveredCount++;
      console.log(`✗ BLOCKED: ${s.title}`);
      console.log(`   Slug: ${s.slug}`);
      const storyId = storyIdFromSlug(s.slug);
      const tokens = titleTokensNew(s.title, placeNames);
      console.log(`   Story ID: ${storyId}`);
      console.log(`   Tokens: ${Array.from(tokens).join(", ")}`);
      // Find which story blocked it
      for (const c of covered) {
        if (storyId && c.storyId && storyId === c.storyId) {
          const idx = covered.indexOf(c);
          console.log(`   Blocked by: Story ID match with "${stories[idx].title}"`);
          break;
        }
        let hit = 0;
        for (const w of tokens) if (c.tokens.has(w)) hit++;
        if (hit >= 3 && hit / tokens.size >= 0.6) {
          const idx = covered.indexOf(c);
          console.log(`   Blocked by: ${stories[idx].title}`);
          console.log(`   Shared tokens: ${Array.from(tokens).filter(w => c.tokens.has(w)).join(", ")} (${hit}/${tokens.size} = ${(hit / tokens.size * 100).toFixed(0)}%)`);
          break;
        }
      }
      console.log();
    }
  });
  console.log(`Total blocked by new logic: ${newCoveredCount} / ${remaining.length}`);
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Old logic blocked: ${oldCoveredCount} / ${remaining.length} (${(oldCoveredCount / remaining.length * 100).toFixed(0)}%)`);
  console.log(`New logic blocked: ${newCoveredCount} / ${remaining.length} (${(newCoveredCount / remaining.length * 100).toFixed(0)}%)`);
  console.log(`False positives eliminated: ${oldCoveredCount - newCoveredCount}`);
}

main().catch(console.error);
