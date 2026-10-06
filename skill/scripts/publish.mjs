/**
 * Campaign → Postproxy posts. Drafts by default; `live` publishes right after creating them;
 * `scheduledAt` schedules. Every created/published post is appended to the tenant's posts.jsonl
 * so inbox/stats know which posts are ours without asking the API to enumerate everything.
 *
 * A campaign's `posts` map says what goes where:
 *
 *   "posts": {
 *     "twitter":        { "body": "…", "media": "x" },
 *     "instagram_reel": { "body": "…", "media": "reel", "cover": true, "first_comment": "…" },
 *     "instagram_post": { "body": "…", "media": ["slide-cover", "slide-dek", "slide-close"], "alt_text": ["…", "…", "…"] }
 *   }
 *
 * `media` names a render variant (its video, or its still when the variant is a slide),
 * `<variant>-still` (the PNG final frame), or an array of those — two or more images on an
 * Instagram feed post is a carousel. An absolute path or URL is used as-is.
 * Posts with `"enabled": false` are skipped. `thread` is the list of reply posts.
 */
import { existsSync, statSync } from "node:fs";
import { logPost } from "./config.mjs";
import { LIMITS, createClient, pickProfile, summarizePost } from "./postproxy.mjs";
import { readManifest } from "./video.mjs";

export const POST_KINDS = {
  twitter: { platform: "twitter", format: null, limits: LIMITS.twitter },
  instagram_post: { platform: "instagram", format: "post", limits: LIMITS.instagram_post },
  instagram_reel: { platform: "instagram", format: "reel", limits: LIMITS.instagram_reel },
  instagram_story: { platform: "instagram", format: "story", limits: LIMITS.instagram_story },
  tiktok: { platform: "tiktok", format: "video", limits: LIMITS.tiktok },
  threads: { platform: "threads", format: null, limits: { chars: 500 } },
  bluesky: { platform: "bluesky", format: null, limits: { chars: 300 } },
  linkedin: { platform: "linkedin", format: null, limits: { chars: 3000 } },
  facebook: { platform: "facebook", format: "post", limits: { chars: 63206 } },
};

/** Resolve one `media` reference to a file path or URL. A slide variant resolves to its PNG. */
export function resolveMedia(ref, manifest) {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref) || ref.startsWith("/")) return ref;
  const still = ref.endsWith("-still");
  const variant = still ? ref.slice(0, -6) : ref;
  const out = manifest?.outputs?.[variant];
  if (!out) throw new Error(`media ${JSON.stringify(ref)} refers to variant ${JSON.stringify(variant)} which has no render — run: ziggy video <tenant> <campaign> or ziggy slides <tenant> <campaign>`);
  const file = still ? out.still : (out.video && existsSync(out.video) ? out.video : out.still);
  if (!file || !existsSync(file)) throw new Error(`media file for ${ref} is missing (${file || "no still captured"})`);
  return file;
}

/** `media` is one reference or a list (an Instagram carousel). */
export function resolveMediaList(ref, manifest) {
  const refs = Array.isArray(ref) ? ref : ref ? [ref] : [];
  return refs.map((r) => resolveMedia(r, manifest));
}

/** Static checks before anything is uploaded: text length, file size, extension, carousel count. */
export function validatePost(kind, spec, mediaPaths) {
  const def = POST_KINDS[kind];
  if (!def) throw new Error(`unknown post kind ${JSON.stringify(kind)}; known: ${Object.keys(POST_KINDS).join(", ")}`);
  const problems = [];
  const chars = def.limits.chars;
  if (chars && (spec.body || "").length > chars) problems.push(`${kind}: body is ${spec.body.length} chars, limit ${chars}`);
  for (const [i, child] of (spec.thread || []).entries()) {
    if (chars && (child.body || "").length > chars) problems.push(`${kind}: thread[${i}] is ${child.body.length} chars, limit ${chars}`);
  }
  const paths = Array.isArray(mediaPaths) ? mediaPaths : mediaPaths ? [mediaPaths] : [];
  let images = 0;
  let videos = 0;
  for (const mediaPath of paths) {
    if (!mediaPath || /^https?:\/\//i.test(mediaPath)) {
      if (mediaPath && /\.(mp4|mov|webm)(\?|$)/i.test(mediaPath)) videos++;
      else if (mediaPath) images++;
      continue;
    }
    const ext = mediaPath.split(".").pop().toLowerCase();
    const videoFormats = def.limits.video?.formats || ["mp4", "mov"];
    const isVideo = videoFormats.includes(ext);
    const limit = isVideo ? def.limits.video : def.limits.image;
    if (isVideo) videos++; else images++;
    if (limit) {
      if (!limit.formats.includes(ext)) problems.push(`${kind}: .${ext} is not accepted (${limit.formats.join(", ")})`);
      const bytes = statSync(mediaPath).size;
      if (bytes > limit.maxBytes) problems.push(`${kind}: ${Math.round(bytes / 1024 / 1024)} MB exceeds ${Math.round(limit.maxBytes / 1024 / 1024)} MB`);
    }
  }
  const imageCap = def.limits.image?.count;
  if (imageCap && images > imageCap) problems.push(`${kind}: ${images} images, limit ${imageCap}`);
  if (videos > 1) problems.push(`${kind}: only one video per post`);
  if (videos && images && def.platform === "twitter") problems.push(`${kind}: X cannot mix images and video`);
  if (def.format === "reel" && paths.length !== 1) problems.push(`${kind}: a reel takes one video`);
  if (!paths.length && ["instagram", "tiktok"].includes(def.platform)) problems.push(`${kind}: ${def.platform} requires media`);
  if (def.platform === "tiktok" && def.format === "video" && images) problems.push(`${kind}: a TikTok video post cannot take images`);
  return problems;
}

/** Build the request for one campaign post. Pure. */
export function buildRequest(kind, spec, { profile, manifest, draft, scheduledAt }) {
  const def = POST_KINDS[kind];
  const media = resolveMediaList(spec.media, manifest);
  const params = {};
  if (def.format) params.format = def.format;
  if (spec.first_comment) params.first_comment = spec.first_comment;
  if (spec.alt_text) params.alt_text = spec.alt_text;
  if (spec.collaborators) params.collaborators = spec.collaborators;
  if (spec.made_with_ai != null) params.made_with_ai = spec.made_with_ai;
  if (spec.cover && kind === "instagram_reel") {
    const coverRef = typeof spec.cover === "string" ? spec.cover : `${spec.media}-still`;
    const cover = resolveMedia(coverRef, manifest);
    if (/^https?:\/\//i.test(cover)) params.cover_url = cover; else params.cover_file = cover;
  }
  for (const [k, v] of Object.entries(spec.platform || {})) params[k] = v;
  return {
    kind,
    request: { body: spec.body || "", profiles: [profile.id], media, platforms: { [def.platform]: params }, draft, scheduledAt, thread: Array.isArray(spec.thread) ? spec.thread.map((child) => ({ body: child.body || "" })) : undefined },
    problems: validatePost(kind, spec, media),
    media,
  };
}

/**
 * Create the campaign's posts. Returns [{ kind, post, published }].
 * `client` defaults to a Postproxy client reading POSTPROXY_API_KEY.
 */
export async function publishCampaign({ tenant, campaign, live = false, scheduledAt, only, client = createClient(), log = () => {}, dryRun = false }) {
  const manifest = readManifest(tenant.slug, campaign.name);
  const profiles = await client.listProfiles();
  const results = [];
  const entries = Object.entries(campaign.posts || {}).filter(([kind, spec]) => spec && spec.enabled !== false && (!only?.length || only.includes(kind)));
  if (!entries.length) throw new Error(`campaign ${campaign.name} defines no posts`);

  const plans = [];
  for (const [kind, spec] of entries) {
    const def = POST_KINDS[kind];
    if (!def) throw new Error(`unknown post kind ${JSON.stringify(kind)}`);
    const profile = pickProfile(profiles, def.platform, tenant.postproxy?.profileGroupId);
    if (!profile) throw new Error(`no active ${def.platform} profile connected on Postproxy for ${tenant.slug}`);
    plans.push({ ...buildRequest(kind, spec, { profile, manifest, draft: !live, scheduledAt }), profile });
  }
  const problems = plans.flatMap((p) => p.problems);
  if (problems.length) throw new Error(`campaign ${campaign.name} is not publishable:\n  ${problems.join("\n  ")}`);

  for (const plan of plans) {
    const names = (plan.media || []).map((m) => m.split("/").pop());
    log(`→ ${plan.kind} on ${plan.profile.name}${names.length ? ` (${names.join(", ")})` : ""}`);
    if (dryRun) { results.push({ kind: plan.kind, request: plan.request, profile: plan.profile.name, dryRun: true }); continue; }
    const post = await client.createPost(plan.request);
    logPost(tenant.slug, { campaign: campaign.name, kind: plan.kind, postId: post.id, profileId: plan.profile.id, platform: POST_KINDS[plan.kind].platform, status: post.status, live, scheduledAt: scheduledAt || null, link: campaign.story?.url || campaign.link || null });
    results.push({ kind: plan.kind, post, profile: plan.profile.name, published: live });
    log(`  ${summarizePost(post).split("\n")[0]}`);
  }
  return results;
}

export async function publishDrafts({ tenant, postIds, client = createClient(), log = () => {} }) {
  const out = [];
  for (const id of postIds) {
    const post = await client.publishPost(id);
    logPost(tenant.slug, { postId: id, status: post.status, event: "publish" });
    out.push(post);
    log(summarizePost(post));
  }
  return out;
}

/** Poll until every platform is published/failed (or `timeoutMs`). */
export async function awaitPosts({ postIds, client = createClient(), intervalMs = 10000, timeoutMs = 180000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const start = Date.now();
  let posts = [];
  for (;;) {
    posts = await Promise.all(postIds.map((id) => client.getPost(id)));
    const done = posts.every((p) => (p.platforms || []).length && (p.platforms || []).every((pl) => ["published", "failed", "error"].includes(pl.status)));
    if (done || Date.now() - start > timeoutMs) return posts;
    await sleep(intervalMs);
  }
}
