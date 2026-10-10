/**
 * Postproxy API client (https://postproxy.dev) — the only module that talks to the network
 * for publishing. Local media is sent as multipart/form-data (`post[body]`, `profiles[]`,
 * `media[]`, `platforms[<platform>][<param>]`); remote media as JSON.
 *
 * The key is taken from the environment at call time and appears in nothing but the
 * Authorization header. Errors echo the API's response body, which never contains the key.
 */
import { openAsBlob } from "node:fs";
import { basename, extname } from "node:path";
import { KEY_ENV } from "./secrets.mjs";

export const DEFAULT_BASE_URL = "https://api.postproxy.dev";

export const LIMITS = {
  twitter: { image: { maxBytes: 5 * 1024 * 1024, formats: ["jpg", "jpeg", "png", "webp", "gif"], count: 4 }, video: { maxBytes: 512 * 1024 * 1024, formats: ["mp4", "mov"], seconds: [1, 140] }, chars: 280 },
  instagram_post: { image: { maxBytes: 8 * 1024 * 1024, formats: ["jpg", "jpeg", "png"], count: 10 }, video: { maxBytes: 300 * 1024 * 1024, formats: ["mp4", "mov"], seconds: [3, 3600] }, chars: 2200 },
  instagram_reel: { video: { maxBytes: 300 * 1024 * 1024, formats: ["mp4", "mov"], seconds: [3, 5400] }, chars: 2200 },
  instagram_story: { image: { maxBytes: 8 * 1024 * 1024, formats: ["jpg", "jpeg", "png"] }, video: { maxBytes: 100 * 1024 * 1024, formats: ["mp4", "mov"], seconds: [1, 3600] } },
  tiktok: { video: { maxBytes: 4 * 1024 * 1024 * 1024, formats: ["mp4", "mov", "webm"], seconds: [3, 600] }, image: { maxBytes: 20 * 1024 * 1024, formats: ["jpg", "gif"], count: 35 }, chars: 2200 },
  facebook_reel: { video: { maxBytes: 300 * 1024 * 1024, formats: ["mp4", "mov"], seconds: [3, 90] }, chars: 63206 },
};

const MIME = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export function mimeFor(path) {
  return MIME[extname(path).slice(1).toLowerCase()] || "application/octet-stream";
}

export class PostproxyError extends Error {
  constructor(status, body, url) {
    super(`Postproxy ${status} on ${url}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export function createClient({ baseUrl = process.env.ZIGGY_POSTPROXY_BASE_URL || DEFAULT_BASE_URL, apiKey = process.env[KEY_ENV], fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error(`${KEY_ENV} is not set — run this through \`ziggy keys run <tenant> -- …\` or let ziggy wrap it with hush.`);
  const headers = { Authorization: `Bearer ${apiKey}` };

  async function request(method, path, { json, form, query } = {}) {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(json);
    } else if (form) {
      init.body = form; // fetch sets the multipart boundary
    }
    const res = await fetchImpl(url, init);
    const text = await res.text();
    let body = text;
    try { body = text ? JSON.parse(text) : {}; } catch { /* keep text */ }
    if (!res.ok) throw new PostproxyError(res.status, body, url.pathname);
    return body;
  }

  const data = (r) => (r && typeof r === "object" && "data" in r ? r.data : r);
  const enc = encodeURIComponent;

  return {
    baseUrl,
    listProfiles: () => request("GET", "/api/profiles").then(data),
    listProfileGroups: () => request("GET", "/api/profile_groups").then(data),
    listPosts: (query) => request("GET", "/api/posts", { query }).then(data),
    getPost: (id, query) => request("GET", `/api/posts/${enc(id)}`, { query }).then(data),
    publishPost: (id, query) => request("POST", `/api/posts/${enc(id)}/publish`, { query }).then(data),
    deletePost: (id) => request("DELETE", `/api/posts/${enc(id)}`).then(data),
    /** Move a scheduled post (Postproxy accepts it until 5 minutes before publish time); no media re-upload. */
    reschedulePost: (id, scheduledAt) => request("PATCH", `/api/posts/${enc(id)}`, { json: { post: { scheduled_at: scheduledAt } } }).then(data),

    /* engagement */
    postStats: ({ postIds, profiles, from, to } = {}) => request("GET", "/api/posts/stats", { query: { post_ids: postIds?.join(","), profiles: Array.isArray(profiles) ? profiles.join(",") : profiles, from, to } }).then(data),
    profileStats: (profileId, query) => request("GET", `/api/profiles/${enc(profileId)}/stats`, { query }).then(data),
    profileDailyStats: (profileId, query) => request("GET", `/api/profiles/${enc(profileId)}/daily_stats`, { query }).then(data),

    /* comments (Instagram, Facebook, Threads, Bluesky, YouTube — X has no comment API) */
    listComments: (postId, profileId, query) => request("GET", `/api/posts/${enc(postId)}/comments`, { query: { profile_id: profileId, ...query } }).then(data),
    createComment: (postId, profileId, { body, parentId } = {}) => request("POST", `/api/posts/${enc(postId)}/comments`, { query: { profile_id: profileId }, json: parentId ? { body, parent_id: parentId } : { body } }).then(data),
    hideComment: (postId, profileId, commentId, hide = true) => request("POST", `/api/posts/${enc(postId)}/comments/${enc(commentId)}/${hide ? "hide" : "unhide"}`, { query: { profile_id: profileId } }).then(data),
    likeComment: (postId, profileId, commentId, like = true) => request("POST", `/api/posts/${enc(postId)}/comments/${enc(commentId)}/${like ? "like" : "unlike"}`, { query: { profile_id: profileId } }).then(data),
    deleteComment: (postId, profileId, commentId) => request("DELETE", `/api/posts/${enc(postId)}/comments/${enc(commentId)}`, { query: { profile_id: profileId } }).then(data),
    privateReply: (postId, profileId, commentId, text) => request("POST", `/api/posts/${enc(postId)}/comments/${enc(commentId)}/private_reply`, { query: { profile_id: profileId }, json: { text } }).then(data),

    /* direct messages */
    listChats: (profileId, query) => request("GET", `/api/profiles/${enc(profileId)}/chats`, { query }).then(data),
    listMessages: (chatId, query) => request("GET", `/api/chats/${enc(chatId)}/messages`, { query }).then(data),
    sendMessage: (chatId, { body, media } = {}) => request("POST", `/api/chats/${enc(chatId)}/messages`, { json: media ? { media } : { body } }).then(data),

    /**
     * Create a post. `media` entries are local paths (multipart) or http(s) URLs (JSON).
     * `platforms` is `{ instagram: { format: "reel", cover_file: "/path/cover.jpg", … } }` — a
     * local path in a `*_file` param is uploaded, everything else is sent as a field.
     */
    async createPost({ body = "", profiles, media = [], platforms = {}, draft = false, scheduledAt, profileGroupId, thread } = {}) {
      if (!profiles?.length) throw new Error("createPost: profiles[] is required");
      const hasLocal = media.some((m) => !/^https?:\/\//i.test(m)) || Object.values(platforms).some((p) => Object.entries(p || {}).some(([k, v]) => k.endsWith("_file") && typeof v === "string"));
      if (!hasLocal) {
        const json = { post: { body, draft }, profiles, media, platforms };
        if (scheduledAt) json.post.scheduled_at = scheduledAt;
        if (profileGroupId) json.profile_group_id = profileGroupId;
        if (thread) json.thread = thread;
        return request("POST", "/api/posts", { json }).then(data);
      }
      const form = new FormData();
      form.append("post[body]", body);
      if (draft) form.append("post[draft]", "true");
      if (scheduledAt) form.append("post[scheduled_at]", scheduledAt);
      if (profileGroupId) form.append("profile_group_id", profileGroupId);
      for (const p of profiles) form.append("profiles[]", p);
      for (const m of media) {
        if (/^https?:\/\//i.test(m)) form.append("media[]", m);
        else form.append("media[]", await openAsBlob(m, { type: mimeFor(m) }), basename(m));
      }
      if (Array.isArray(thread)) {
        thread.forEach((child, i) => {
          if (child?.body) form.append(`thread[${i}][body]`, child.body);
        });
      }
      // A platform whose params contain booleans or numbers travels as one JSON `platforms` field
      // so values keep their type — flattened `platforms[p][k]` fields are strings, which strict
      // validators (TikTok's booleans) reject. Platforms with a `*_file` upload stay flattened.
      const typed = {};
      for (const [platform, params] of Object.entries(platforms)) {
        const entries = Object.entries(params || {}).filter(([, v]) => v != null);
        if (!entries.length) continue;
        const hasFile = entries.some(([k, v]) => k.endsWith("_file") && typeof v === "string");
        const hasTyped = entries.some(([, v]) => typeof v === "boolean" || typeof v === "number");
        if (!hasFile && hasTyped) {
          typed[platform] = Object.fromEntries(entries);
          continue;
        }
        for (const [k, v] of entries) {
          if (k.endsWith("_file") && typeof v === "string") form.append(`platforms[${platform}][${k}]`, await openAsBlob(v, { type: mimeFor(v) }), basename(v));
          else if (Array.isArray(v)) for (const item of v) form.append(`platforms[${platform}][${k}][]`, String(item));
          else form.append(`platforms[${platform}][${k}]`, String(v));
        }
      }
      if (Object.keys(typed).length) form.append("platforms", JSON.stringify(typed));
      return request("POST", "/api/posts", { form }).then(data);
    },
  };
}

/** Normalize a comment record across platforms into { id, body, author, createdAt, parentId, replies[] }. */
export function normalizeComment(c) {
  if (!c || typeof c !== "object") return null;
  const author = c.author_username || c.author?.username || c.author?.name || c.username || c.author_name || c.from?.username || c.from?.name || null;
  return {
    id: c.id,
    body: c.body ?? c.text ?? c.message ?? "",
    author,
    authorId: c.author_external_id || c.author?.id || c.author_id || c.from?.id || null,
    createdAt: c.posted_at || c.created_at || c.timestamp || c.createdAt || null,
    parentId: c.parent_id || c.parent_external_id || null,
    hidden: Boolean(c.hidden || c.is_hidden),
    likes: c.like_count ?? null,
    mine: Boolean(c.is_own || c.from_page || c.by_profile || c.mine),
    replies: (c.replies || []).map(normalizeComment).filter(Boolean),
    raw: c,
  };
}

/**
 * Pick a profile for a platform. Exact ids (`profileIds`, tenant.postproxy.profileIds) win,
 * then the profile group, and only as a last resort the first active profile of the platform.
 * Cross-tenant safety: on a shared Postproxy account, picking "the first instagram profile"
 * would happily send tenant A's reel to tenant B's account.
 */
export function pickProfile(profiles, platform, { groupId = null, profileIds = null } = {}) {
  const active = (profiles || []).filter((p) => p.platform === platform && (p.status ?? "active") === "active");
  if (profileIds?.length) {
    const byId = profileIds.map((id) => active.find((p) => p.id === id)).find(Boolean);
    if (byId) return byId;
  }
  const list = active.filter((p) => !groupId || p.profile_group_id === groupId);
  return list[0] || null;
}

/** One-line human summary of a post record (id, status, per-platform status + permalink). */
export function summarizePost(post) {
  const p = post?.data || post || {};
  const lines = [`${p.id}  status=${p.status}`];
  for (const plat of p.platforms || []) {
    const url = plat.permalink || plat.url || "";
    lines.push(`    ${plat.platform}: ${plat.status}${url ? "  " + url : ""}${plat.error ? "  error=" + plat.error : ""}`);
  }
  return lines.join("\n");
}

export function postPermalinks(post) {
  const p = post?.data || post || {};
  return (p.platforms || []).map((plat) => ({ platform: plat.platform, status: plat.status, url: plat.permalink || plat.url || null, error: plat.error || null }));
}
