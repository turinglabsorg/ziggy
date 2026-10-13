/**
 * Case File campaigns: sourced UAP facts with perspective (Confirmed/Not confirmed/Why it matters).
 * Additional format for Alien Watch, runs alongside news/story format.
 *
 * A case file is:
 * - A fact from official docs, FOIA replies, or reputable outlets (sourced)
 * - Followed by Confirmed / Not confirmed / Why it matters points
 * - Always ends pointing to alienwatch.buzz
 * - No re-uploads of others' videos; only official public-domain or our own card
 * - Keeps source hedges; never invents facts
 */
import { saveCampaign } from "./config.mjs";
import { slugify, formatDate } from "./story.mjs";
import { composeThread } from "./thread.mjs";
import { SLIDE_IDS } from "./slides.mjs";

/** Case file reel duration: ~7s title + 4.5s per point + 4s close */
export function casefileDuration(pointCount = 3) {
  return Math.max(15, Math.round(7 + pointCount * 4.5 + 4));
}

/**
 * Build a case file campaign object.
 * 
 * @param {object} tenant - The tenant configuration
 * @param {object} item - Case file item { headline, dek, points: [confirmed, notConfirmed, whyMatters], source: {outlet, url}, date?, caseNum? }
 * @param {object} options - { name?, template? }
 */
export function campaignFromCasefile(tenant, item, { name, template } = {}) {
  const lang = tenant.language || "en";
  const date = item.date ? item.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const slug = item.slug || slugify(item.headline);
  const campaignName = name || `casefile-${date}-${slug.split("-").slice(0, 4).join("-")}`.slice(0, 48).replace(/-+$/, "");
  const social = tenant.social || {};
  const displayUrl = tenant.feed?.displayUrl || (tenant.site ? new URL(tenant.site).hostname : "");
  
  // Default to alternating templates if not specified
  const templates = ["casefile-dossier", "casefile-radar"];
  const selectedTemplate = template || templates[Math.floor(Date.now() / 86400000) % templates.length];
  
  // kicker: "CASE FILE · <date>"
  const kicker = `CASE FILE · ${formatDate(date, lang)}`;
  
  // meta: source outlet
  const sourceOutlet = item.source?.outlet || "Source";
  const sourceUrl = item.source?.url || "";
  const meta = `Source: ${sourceOutlet}`;
  
  // Points must be exactly 3: Confirmed / Not confirmed / Why it matters
  const points = Array.isArray(item.points) && item.points.length === 3 
    ? item.points.map(p => String(p).trim()) 
    : ["", "", ""];
  
  if (points.some(p => !p)) {
    throw new Error("Case file requires exactly 3 points: Confirmed, Not confirmed, Why it matters");
  }
  
  // Caption carries the full story: headline, dek, the three points, source, then CTA
  const cta = (social.cta || "Full story with sources: {url}").replace("{url}", displayUrl).replace("{site}", displayUrl);
  const hashtags = (social.hashtags || "#UFO #UAP #Space #Astronomy").trim();
  
  const pointsBlock = `\n\n✅ Confirmed: ${points[0]}\n\n❓ Not confirmed: ${points[1]}\n\nWhy it matters: ${points[2]}`;
  const sourceLine = sourceUrl ? `\n\nSource: ${sourceOutlet} · ${sourceUrl}` : `\n\nSource: ${sourceOutlet}`;
  const caption = `${item.headline}\n\n${item.dek}${pointsBlock}${sourceLine}\n\n${cta}${hashtags ? `\n\n${hashtags}` : ""}`;
  
  // Thread for X (optional, manually enabled)
  const thread = composeThread({ title: item.headline, dek: item.dek, url: `https://${displayUrl}`, limit: 280 });
  
  // Extra platforms from tenant config
  const extra = new Set(social.platforms || []);
  
  return {
    template: selectedTemplate,
    language: lang,
    duration: casefileDuration(points.length),
    intent: `Case File: ${item.headline}`,
    casefile: {
      source: sourceUrl,
      outlet: sourceOutlet,
      date: date,
      caseNum: item.caseNum || "",
    },
    copy: {
      kicker,
      headline: item.headline,
      dek: item.dek,
      points,
      meta: sourceOutlet,
      url: displayUrl,
    },
    image: item.image || null, // Optional: case file card background or public-domain official image
    audio: { 
      bed: social.bed || "ambient", 
      volume: 0.6, 
      swellAt: 1.6, 
      beats: [[0.6, 1318.5, 1.2, 0.07], [1.5, 659.3, 1.6, 0.06], [7.6, 987.8, 0.9, 0.035]] 
    },
    posts: {
      instagram_reel: {
        body: caption,
        media: "reel",
        cover: true,
      },
      instagram_post: {
        body: caption,
        media: [...SLIDE_IDS],
        alt_text: [item.headline, item.dek, `${tenant.name} — ${displayUrl}`].filter(Boolean),
        enabled: extra.has("instagram_post"),
      },
      twitter: {
        body: thread.body,
        media: "slide-cover",
        alt_text: item.headline,
        thread: thread.thread,
        enabled: false, // Manual: needs slide-cover still
      },
      tiktok: {
        body: caption,
        media: "reel",
        platform: { 
          privacy_status: "PUBLIC_TO_EVERYONE", 
          disable_comment: false, 
          disable_duet: true, 
          disable_stitch: true 
        },
        enabled: extra.has("tiktok"),
      },
      facebook_reel: {
        body: caption,
        media: "reel",
        enabled: extra.has("facebook_reel"),
      },
    },
  };
}

/**
 * Create a case file campaign from an item.
 * 
 * @param {object} tenant - The tenant configuration
 * @param {object} item - Case file item
 * @param {object} options - { name?, template?, force?, write? }
 * @returns {object} { name, dir, campaign }
 */
export async function createCasefileCampaign(tenant, item, { name, template, force = false, write = true } = {}) {
  const campaign = campaignFromCasefile(tenant, item, { name, template });
  const campaignName = campaign.intent.replace(/^Case File:\s*/, "casefile-").slice(0, 48);
  
  if (!write) {
    return { name: campaignName, dir: null, campaign: { ...campaign, name: campaignName } };
  }
  
  let exists = false;
  try {
    const { loadCampaign } = await import("./config.mjs");
    loadCampaign(tenant.slug, campaignName);
    exists = true;
  } catch {
    /* new */
  }
  
  if (exists && !force) {
    throw new Error(`campaign ${campaignName} already exists for ${tenant.slug} — pass --force to overwrite`);
  }
  
  const dir = saveCampaign(tenant.slug, campaignName, campaign);
  return { name: campaignName, dir, campaign };
}

/**
 * Check if a tenant has case files enabled.
 */
export function casefileEnabled(tenant) {
  return tenant.casefile?.enabled === true;
}

/**
 * Get case file candidates for a tenant (placeholder for future candidate sourcing).
 * In a full implementation, this would read from configured source feeds/URLs.
 */
export async function getCasefileCandidates(tenant) {
  if (!casefileEnabled(tenant)) return [];
  
  // Placeholder: in production, this would fetch from configured sources
  // tenant.casefile.sources could be an array of { type: "manual", path: "..." } etc
  return [];
}
