// Schedule rendered campaigns, in the order given, into the tenant's next free times on every
// platform it publishes to (tenant.daily.only). One story per time, never next to one already
// queued. Ragusa: on the hour, 08:00–23:00 local, never after a story's deadline (the day after
// its date). Alien Watch: its fixed slots plus the half-slots between them. A profile Postproxy
// reports as not active is left out and reported.
// Runs in the container: node ops/round/schedule.mjs <slug> <campaign>... [--dry-run]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
process.env.ZIGGY_HOME ||= "/data";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [slug, ...campaigns] = args.filter((a) => !a.startsWith("--"));
if (!slug || !campaigns.length) { console.error("usage: node ops/round/schedule.mjs <slug> <campaign>... [--dry-run]"); process.exit(2); }
process.env.POSTPROXY_API_KEY = process.env[`POSTPROXY_API_KEY_${slug.toUpperCase()}`] || process.env.POSTPROXY_API_KEY;
const { loadTenant, loadCampaign } = await import("../../skill/scripts/config.mjs");
const { dailyConfig, livePosts } = await import("../../skill/scripts/daily.mjs");
const { createClient } = await import("../../skill/scripts/postproxy.mjs");
const { POST_KINDS } = await import("../../skill/scripts/publish.mjs");

const tenant = loadTenant(slug);
const daily = dailyConfig(tenant);
const tz = daily.tz;
const offsetMs = Date.parse("2000-01-01T00:00:00Z") - Date.parse(`2000-01-01T00:00:00${tz}`);
const localDay = (ms) => new Date(ms + offsetMs).toISOString().slice(0, 10);
const at = (day, hm) => Date.parse(`${day}T${hm}:00${tz}`);
const now = Date.now();

// which kinds can go out: the profile behind each must be active on Postproxy
const profiles = await createClient().listProfiles();
const pinned = new Set(tenant.postproxy?.profileIds || []);
const kinds = [], down = [];
for (const kind of daily.only) {
  const platform = POST_KINDS[kind]?.platform;
  const prof = profiles.find((p) => p.platform === platform && (!pinned.size || pinned.has(p.id)));
  if (prof && (prof.status ?? "active") === "active") kinds.push(kind); else down.push(`${kind} (${prof ? prof.status : "no profile"})`);
}

// candidate times, and the ones our queued posts already hold
const layout = slug === "ragusa"
  ? { times: Array.from({ length: 16 }, (_, h) => `${String(h + 8).padStart(2, "0")}:00`), gap: 55 * 60_000 }
  : { times: ["07:00", "10:30", "14:00", "16:30", "19:00", "21:30"], gap: 85 * 60_000 };
const taken = livePosts(slug).map((r) => Date.parse(r.scheduledAt || "")).filter((t) => t > now - 3600_000);
const candidates = [];
for (let d = 0; d < 4; d++) for (const hm of layout.times) candidates.push(at(localDay(now + d * 86400_000), hm));
const free = (t) => t > now + 10 * 60_000 && taken.every((x) => Math.abs(x - t) >= layout.gap);

const results = [];
for (const name of campaigns) {
  const manifest = `/data/tenants/${slug}/renders/${name}/manifest.json`;
  if (!existsSync(manifest) || !JSON.parse(readFileSync(manifest, "utf8")).outputs?.reel?.video) { results.push({ name, error: "no render" }); continue; }
  const campaign = loadCampaign(slug, name);
  const deadline = slug === "ragusa" && campaign.story?.date ? at(localDay(Date.parse(campaign.story.date) + 86400_000), "23:59") : Infinity;
  const time = candidates.sort((a, b) => a - b).find((t) => free(t) && t <= deadline);
  if (!time) { results.push({ name, error: deadline < Infinity ? "no free time before its deadline" : "no free time" }); continue; }
  taken.push(time);
  const iso = new Date(time).toISOString();
  const local = new Date(time + offsetMs).toISOString().slice(5, 16).replace("T", " ");
  if (dryRun || !kinds.length) { results.push({ name, at: iso, local, dryRun, kinds }); continue; }
  try {
    const out = execFileSync("node", ["skill/index.js", "post", slug, name, "--live", "--at", iso, "--only", kinds.join(",")], { cwd: "/app", encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    results.push({ name, at: iso, local, posts: [...new Set(out.match(/[A-Za-z0-9]{7}(?=  status=)/g) || [])] });
  } catch (e) { results.push({ name, at: iso, local, error: String(e.stderr || e.message).trim().split("\n").pop() }); }
}
for (const r of results) console.log(r.error ? `✗ ${r.name}: ${r.error}` : `✓ ${r.local} ${r.name} ${r.posts ? r.posts.join(" ") : "(dry run)"}`);
if (down.length) console.log(`⚠️ not scheduled on: ${down.join(", ")}`);
console.log(JSON.stringify({ tenant: slug, kinds, down, results }));
