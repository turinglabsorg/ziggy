// Create campaigns from points the session wrote: {"<slug prefix>": ["point", …], …}. The story
// comes from the feed (matched by slug prefix); the jingle is the next one in rotation, and a
// key listed in "skip" becomes a skipped campaign (the loop never offers it again).
// Runs in the container: node ops/round/make-campaigns.mjs <slug> <points.json>
import { readFileSync } from "node:fs";
process.env.ZIGGY_HOME ||= "/data";
const { loadTenant, saveCampaign } = await import("../../skill/scripts/config.mjs");
const { fetchStories, campaignFromStory, campaignNameFor } = await import("../../skill/scripts/story.mjs");
const { nextJingle } = await import("../../skill/scripts/music.mjs");

const [slug, file] = process.argv.slice(2);
if (!slug || !file) { console.error("usage: node ops/round/make-campaigns.mjs <slug> <points.json>"); process.exit(2); }
const tenant = loadTenant(slug);
tenant.feed = { ...tenant.feed, url: tenant.feed.url.replace(/limit=\d+/, "limit=100") };
const { skip = [], ...points } = JSON.parse(readFileSync(file, "utf8"));
const stories = await fetchStories(tenant);
const made = [];
for (const [prefix, pts] of [...Object.entries(points), ...skip.map((p) => [p, null])]) {
  const story = stories.find((s) => s.slug.startsWith(prefix));
  if (!story) { console.log(`✗ ${prefix}: not in the feed`); continue; }
  const name = campaignNameFor(tenant, story);
  const campaign = campaignFromStory(tenant, story, { points: pts || undefined });
  if (pts) campaign.audio.jingle = nextJingle(slug);
  else campaign.skip = true;
  saveCampaign(slug, name, campaign);
  if (pts) made.push(name);
  console.log(`${pts ? "✓" : "⤳ skip"} ${name}${pts ? `  ${pts.length} points, ${campaign.duration}s, jingle ${campaign.audio.jingle}, image ${campaign.image ? "yes" : "NO"}` : ""}`);
}
console.log(JSON.stringify({ campaigns: made }));
