/**
 * Stories → campaigns. A tenant that publishes content declares where its stories come from
 * (tenant.json → `feed`), and `ziggy story <slug>` turns the latest one into a campaign on the
 * `story` template: kicker, headline, dek, meta line, link, hero image, and the posts to send.
 *
 *   "feed": {
 *     "url": "https://alienwatch.buzz/feed/v1/briefings?lang=en&limit=5",
 *     "items": "data",                                     // path to the array (optional: the body may be the array)
 *     "fields": { "title": "title", "dek": "dek", "section": "sector.name", "date": "storyDate",
 *                 "image": "imageUrl", "slug": "slug", "sources": "sourceCount", "languages": "languageCount" },
 *     "imageRewrite": { "match": "^.*?/api/assets/tenants/[0-9a-f-]+/", "replace": "https://alienwatch.buzz/assets/" },
 *     "storyUrl": "https://alienwatch.buzz/#/b/{slug}?lang=en",
 *     "displayUrl": "alienwatch.buzz"
 *   }
 *
 * Field paths are dotted (`sector.name`, `data.0.title`). Everything the mapping does not know
 * about is left for the human to fill in the generated campaign.json.
 */
import { loadCampaign, saveCampaign } from "./config.mjs";

export function pick(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export async function fetchStories(tenant, { fetchImpl = fetch } = {}) {
  const feed = tenant.feed;
  if (!feed?.url) throw new Error(`tenant ${tenant.slug} has no feed configured (tenant.json → feed.url)`);
  const res = await fetchImpl(feed.url, { headers: { "User-Agent": "Mozilla/5.0 ziggy", Accept: "application/json" } });
  if (!res.ok) throw new Error(`feed ${feed.url} → ${res.status}`);
  const body = await res.json();
  const items = feed.items ? pick(body, feed.items) : body;
  if (!Array.isArray(items)) throw new Error(`feed did not return an array at ${feed.items || "root"}`);
  return items.map((it) => normalizeStory(it, feed));
}

export function normalizeStory(item, feed) {
  const f = feed.fields || {};
  const get = (k, fallback) => pick(item, f[k] ?? k) ?? fallback;
  let image = get("image", null);
  if (image && feed.imageRewrite?.match) image = String(image).replace(new RegExp(feed.imageRewrite.match), feed.imageRewrite.replace || "");
  const slug = get("slug", null) || slugify(get("title", "story"));
  return {
    title: get("title", ""),
    dek: get("dek", ""),
    section: get("section", null),
    date: get("date", null) || get("publishedAt", null),
    image,
    slug,
    sources: get("sources", null),
    languages: get("languages", null),
    url: feed.storyUrl ? feed.storyUrl.replace("{slug}", slug) : null,
    raw: item,
  };
}

export function slugify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);
}

export function formatDate(iso, lang = "en") {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
  } catch { return iso.slice(0, 10); }
}

/** Build the campaign object for a story. Pure. */
export function campaignFromStory(tenant, story, { name } = {}) {
  const feed = tenant.feed || {};
  const lang = tenant.language || "en";
  const date = story.date ? story.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const campaignName = name || `story-${date}-${story.slug.split("-").slice(0, 4).join("-")}`.slice(0, 48).replace(/-+$/, "");
  const displayUrl = feed.displayUrl || (tenant.site ? new URL(tenant.site).hostname : "");
  const kicker = [story.section, formatDate(story.date, lang)].filter(Boolean).join(" · ");
  const meta = [story.sources != null ? `${story.sources} source${story.sources === 1 ? "" : "s"}` : null, story.languages != null ? `${story.languages} language${story.languages === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const sourcesLine = story.sources != null ? ` Sourced from ${plural(story.sources, "report")}${story.languages ? ` in ${plural(story.languages, "language")}` : ""}.` : "";
  return {
    template: "story",
    language: lang,
    duration: 12,
    intent: `Story reel: ${story.title}`,
    story: { slug: story.slug, url: story.url, date: story.date, section: story.section },
    copy: { kicker, headline: story.title, dek: story.dek, meta, url: displayUrl },
    image: story.image,
    audio: { bed: "ambient", volume: 0.6, swellAt: 1.6, beats: [[0.6, 1318.5, 1.2, 0.07], [1.5, 659.3, 1.6, 0.06], [7.6, 987.8, 0.9, 0.035]] },
    posts: {
      instagram_reel: {
        body: `${story.title}\n\n${story.dek}${sourcesLine}\n\nWant the full story with its sources? Comment LINK and we'll send it to you. Also at ${displayUrl} (link in bio).\n\n#UFO #UAP #Space #Astronomy`,
        media: "reel",
        cover: true,
        first_comment: "Comment LINK and we'll DM you the full story with sources.",
      },
      twitter: {
        body: `${story.title}\n\n${story.dek}\n\n${story.url || displayUrl}`,
        media: "reel",
        enabled: false,
      },
    },
  };
}

/** Fetch the latest (or N-th) story and write it as a campaign. Returns { name, dir, story }. */
export async function createStoryCampaign(tenant, { index = 0, name, fetchImpl, force = false } = {}) {
  const stories = await fetchStories(tenant, { fetchImpl });
  const story = stories[index];
  if (!story) throw new Error(`the feed has ${stories.length} stor${stories.length === 1 ? "y" : "ies"}; index ${index} is out of range`);
  const campaign = campaignFromStory(tenant, story, { name });
  const campaignName = name || campaign.intent && (name || defaultName(tenant, story));
  let exists = false;
  try { loadCampaign(tenant.slug, campaignName); exists = true; } catch { /* new */ }
  if (exists && !force) throw new Error(`campaign ${campaignName} already exists for ${tenant.slug} — pass --force to overwrite`);
  const dir = saveCampaign(tenant.slug, campaignName, campaign);
  return { name: campaignName, dir, story, campaign };
}

function defaultName(tenant, story) {
  const date = story.date ? story.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `story-${date}-${story.slug.split("-").slice(0, 4).join("-")}`.slice(0, 48).replace(/-+$/, "");
}
