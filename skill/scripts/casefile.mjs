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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { saveCampaign } from "./config.mjs";
import { slugify, formatDate } from "./story.mjs";
import { composeThread } from "./thread.mjs";
import { SLIDE_IDS } from "./slides.mjs";

const STATE_DIR = process.env.ZIGGY_HOME ? join(process.env.ZIGGY_HOME, "state") : join(process.env.HOME || "/tmp", ".ziggy", "state");

/**
 * Get the last used case file template for a tenant, to alternate across rounds.
 */
function getLastTemplate(slug) {
  const stateFile = join(STATE_DIR, `${slug}-casefile-template.json`);
  try {
    if (existsSync(stateFile)) {
      const data = JSON.parse(readFileSync(stateFile, "utf8"));
      return data.lastTemplate;
    }
  } catch {
    // Ignore errors, will use default
  }
  return null;
}

/**
 * Save the last used case file template for a tenant.
 */
function saveLastTemplate(slug, template) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const stateFile = join(STATE_DIR, `${slug}-casefile-template.json`);
    writeFileSync(stateFile, JSON.stringify({ lastTemplate: template, updatedAt: new Date().toISOString() }));
  } catch {
    // Non-fatal: if state can't be saved, just continue
  }
}

/** Case file reel duration: ~7s title + 4.5s per point + 4s close */
export function casefileDuration(pointCount = 3) {
  return Math.max(15, Math.round(7 + pointCount * 4.5 + 4));
}

/**
 * Build a case file campaign object.
 * 
 * @param {object} tenant - The tenant configuration
 * @param {object} item - Case file item { headline, dek, points, source, labels?, date?, caseNum?, status?, template?, stamp?, stampSub?, at? }
 *                        points: array of 3 strings OR 3 objects { label?, text }
 *                        labels: optional array of 3 label strings (defaults: ["CONFIRMED", "NOT CONFIRMED", "WHY IT MATTERS"])
 * @param {object} options - { name?, template? }
 */
export function campaignFromCasefile(tenant, item, { name, template } = {}) {
  const lang = tenant.language || "en";
  const date = item.date ? item.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const slug = item.slug || slugify(item.headline);
  const campaignName = name || `casefile-${date}-${slug.split("-").slice(0, 4).join("-")}`.slice(0, 48).replace(/-+$/, "");
  const social = tenant.social || {};
  const displayUrl = tenant.feed?.displayUrl || (tenant.site ? new URL(tenant.site).hostname : "");
  
  // Template priority: 1) item.template, 2) options.template, 3) alternate based on persisted state
  const templates = ["casefile-dossier", "casefile-radar"];
  const tenantSlug = tenant.slug || "default";
  const lastTemplate = getLastTemplate(tenantSlug);
  const selectedTemplate = item.template || template || (() => {
    if (lastTemplate) {
      // Alternate: if last was dossier, use radar; if last was radar, use dossier
      return lastTemplate === "casefile-dossier" ? "casefile-radar" : "casefile-dossier";
    }
    // No history: start with dossier
    return "casefile-dossier";
  })();
  
  // Save the selected template for next round
  saveLastTemplate(tenantSlug, selectedTemplate);
  
  // kicker: "CASE FILE · <date>"
  const kicker = `CASE FILE · ${formatDate(date, lang)}`;
  
  // meta: source outlet
  const sourceOutlet = item.source?.outlet || "Source";
  const sourceUrl = item.source?.url || "";
  const meta = `Source: ${sourceOutlet}`;
  
  // Status: released, withheld, redacted, under review (default: withheld)
  const status = item.status || "withheld";
  
  // Stamp text: custom from item, or empty if not provided
  const stamp = item.stamp || "";
  const stampSub = item.stampSub || "";
  
  // Default section labels
  const defaultLabels = ["CONFIRMED", "NOT CONFIRMED", "WHY IT MATTERS"];
  
  // Parse points and labels
  // Points can be: array of 3 strings, OR array of 3 objects { label?, text }
  // Labels can be: item.labels array of 3 strings, OR extracted from point objects, OR defaults
  let points = [];
  let labels = [];
  
  if (Array.isArray(item.points) && item.points.length === 3) {
    const firstIsObject = typeof item.points[0] === "object" && item.points[0] !== null && !Array.isArray(item.points[0]);
    
    if (firstIsObject) {
      // Points are objects { label?, text }
      points = item.points.map(p => String(p.text || "").trim());
      labels = item.points.map((p, i) => String(p.label || "").trim() || defaultLabels[i]);
    } else {
      // Points are strings
      points = item.points.map(p => String(p).trim());
      labels = item.labels && Array.isArray(item.labels) && item.labels.length === 3
        ? item.labels.map(l => String(l).trim())
        : defaultLabels;
    }
  }
  
  // Strip any leading labels if present in text (e.g., "Confirmed: " or "✅ Confirmed: ")
  const stripLabel = (point) => {
    const p = String(point).trim();
    // Remove "Confirmed:", "Not confirmed:", "Why it matters:", with optional emoji/bullets
    return p.replace(/^(?:[✅❓•\-*]\s*)?(?:Confirmed|Not confirmed|Why it matters):\s*/i, "").trim();
  };
  
  points = points.map(p => stripLabel(p));
  
  if (points.length !== 3 || points.some(p => !p)) {
    throw new Error("Case file requires exactly 3 points: Confirmed, Not confirmed, Why it matters");
  }
  
  // Caption carries the full story: headline, dek, the three points, source, then CTA
  const cta = (social.cta || "Full story with sources: {url}").replace("{url}", displayUrl).replace("{site}", displayUrl);
  const hashtags = (social.hashtags || "#UFO #UAP #Space #Astronomy").trim();
  
  const pointsBlock = `\n\n✅ ${labels[0]}: ${points[0]}\n\n❓ ${labels[1]}: ${points[1]}\n\n${labels[2]}: ${points[2]}`;
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
      status: status,
      stamp: stamp,
      stampSub: stampSub,
      labels: labels, // Section labels for templates
    },
    at: item.at || null, // Optional: ISO time to schedule at specific time instead of next free slot
    copy: {
      kicker,
      headline: item.headline,
      dek: item.dek,
      points,
      meta: sourceOutlet,
      url: displayUrl,
    },
    image: item.image || null, // Optional: case file card background or public-domain official image
    imageCredit: item.imageCredit || null, // Optional: credit line printed under the photo
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
        media: "reel",
        alt_text: item.headline,
        thread: thread.thread,
        enabled: extra.has("twitter"),
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
