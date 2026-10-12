// The stories a round should consider, as JSON: in the feed, not covered by a live post or a
// skipped campaign, and still fresh enough to publish. Ragusa (local news) publishes a story at
// the latest the day after its date; Alien Watch takes fresh stories and its archive.
// Runs in the container: node ops/round/pending.mjs <slug> [--archive]
process.env.ZIGGY_HOME ||= "/data";
const { loadTenant } = await import("../../skill/scripts/config.mjs");
const { fetchStories } = await import("../../skill/scripts/story.mjs");
const { coveredStories, storyCovered } = await import("../../skill/scripts/daily.mjs");

const slug = process.argv[2];
const archive = process.argv.includes("--archive");
if (!slug) { console.error("usage: node ops/round/pending.mjs <slug> [--archive]"); process.exit(2); }
const tenant = loadTenant(slug);
tenant.feed = { ...tenant.feed, url: tenant.feed.url.replace(/limit=\d+/, "limit=100") };
const tz = tenant.daily?.tz || "Z";
const offsetMs = Date.parse("2000-01-01T00:00:00Z") - Date.parse(`2000-01-01T00:00:00${tz}`);
const localDay = (ms) => new Date(ms + offsetMs).toISOString().slice(0, 10);
// a story dated D may go out until the end of D+1 (tenant local time)
const deadline = (iso) => Date.parse(`${localDay(Date.parse(iso) + 86400_000)}T23:59:59${tz}`);

const covered = coveredStories(slug);
const stories = (await fetchStories(tenant)).filter((s) => !storyCovered(s, covered));
const now = Date.now();
const out = stories
  .map((s) => ({ prefix: s.slug.slice(0, 40), date: s.date, section: s.section, sources: s.sources, image: Boolean(s.image), title: s.title, dek: s.dek, deadline: slug === "ragusa" ? new Date(deadline(s.date)).toISOString() : null }))
  .filter((s) => (s.deadline ? Date.parse(s.deadline) > now + 30 * 60_000 : archive || Date.parse(s.date) > now - 72 * 3600_000))
  .sort((a, b) => a.date.localeCompare(b.date));
console.log(JSON.stringify({ tenant: slug, now: new Date(now).toISOString(), count: out.length, stories: out }, null, 2));
