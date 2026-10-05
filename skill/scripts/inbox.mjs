/**
 * What is happening on a tenant's accounts: new comments on our posts, open DM threads, and
 * engagement numbers. The inbox is the agent's "notifications"; it is built by polling Postproxy
 * (no public webhook endpoint is needed on the user's machine).
 *
 * State per tenant under ~/.ziggy/tenants/<slug>/inbox/:
 *   seen.json       comment/message ids already surfaced (so each item is new exactly once)
 *   actions.jsonl   every reply / hide / skip the autopilot or a human made through ziggy
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { readPostLog, workDir } from "./config.mjs";
import { createClient, normalizeComment, pickProfile } from "./postproxy.mjs";

const COMMENT_PLATFORMS = new Set(["instagram", "facebook", "threads", "bluesky", "youtube", "linkedin"]);

export function inboxDir(slug) {
  return workDir(slug, "inbox");
}

export function loadSeen(slug) {
  const file = join(inboxDir(slug), "seen.json");
  if (!existsSync(file)) return { comments: {}, messages: {} };
  return JSON.parse(readFileSync(file, "utf8"));
}

export function saveSeen(slug, seen) {
  writeFileSync(join(inboxDir(slug), "seen.json"), JSON.stringify(seen, null, 2) + "\n");
}

export function logAction(slug, action) {
  appendFileSync(join(inboxDir(slug), "actions.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...action }) + "\n");
}

export function readActions(slug) {
  const file = join(inboxDir(slug), "actions.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Our posts for this tenant: the local log first, then (optionally) the API listing. */
export async function ourPosts({ tenant, client, fromApi = true, limit = 50, profiles = null }) {
  const logged = readPostLog(tenant.slug).filter((r) => r.postId);
  // a Postproxy account that serves one brand: every connected profile is ours unless tenant.json narrows it
  const accountProfiles = new Set((profiles || (fromApi ? await client.listProfiles().catch(() => []) : [])).map((p) => p.id));
  const byId = new Map();
  for (const r of logged) byId.set(r.postId, { id: r.postId, kind: r.kind, campaign: r.campaign, profileId: r.profileId, platform: r.platform });
  if (fromApi) {
    try {
      const listed = await client.listPosts({ per_page: limit });
      for (const p of Array.isArray(listed) ? listed : listed?.data || []) {
        const platforms = p.platforms || [];
        const profileIds = new Set(platforms.map((pl) => pl.profile_id).filter(Boolean));
        const configured = tenant.postproxy?.profileIds?.length ? tenant.postproxy.profileIds : null;
        const mine = byId.has(p.id) || (configured ? [...profileIds].some((id) => configured.includes(id)) : accountProfiles.has([...profileIds][0]));
        if (!mine) continue;
        const prev = byId.get(p.id) || { id: p.id };
        byId.set(p.id, { ...prev, status: p.status, body: p.body || p.post?.body, platforms: platforms.map((pl) => ({ platform: pl.platform, profileId: pl.profile_id, status: pl.status, url: pl.permalink || pl.url || null })) });
      }
    } catch (error) {
      // the local log is enough to work; surface the API problem without failing the inbox
      byId.set("__error", { error: error.message });
    }
  }
  const apiError = byId.get("__error")?.error || null;
  byId.delete("__error");
  return { posts: [...byId.values()], apiError };
}

function flatten(comments, postId) {
  const out = [];
  const walk = (c, depth) => { out.push({ ...c, postId, depth }); for (const r of c.replies || []) walk(r, depth + 1); };
  for (const c of comments) walk(c, 0);
  return out;
}

/**
 * Pull comments on our posts and DM threads; mark what is new against seen.json.
 * Returns { posts, comments: { new, all }, chats, errors }.
 */
/** The tenant's own usernames: configured handles + the connected profiles' names. */
export function ownHandles(tenant, profiles) {
  const norm = (s) => String(s || "").toLowerCase().replace(/^@/, "").trim();
  return new Set([...Object.values(tenant.handles || {}).map(norm), ...(profiles || []).map((p) => norm(p.name)), ...(profiles || []).map((p) => norm(p.username))].filter(Boolean));
}

export async function pullInbox({ tenant, client = createClient(), markSeen = true, includeDms = true, log = () => {} }) {
  const seen = loadSeen(tenant.slug);
  const profiles = await client.listProfiles();
  const mine = ownHandles(tenant, profiles);
  const { posts, apiError } = await ourPosts({ tenant, client });
  const errors = apiError ? [apiError] : [];
  const all = [];

  for (const post of posts) {
    const platforms = post.platforms?.length ? post.platforms : [{ platform: post.platform, profileId: post.profileId }];
    for (const pl of platforms) {
      if (!COMMENT_PLATFORMS.has(pl.platform)) continue;
      const profileId = pl.profileId || pickProfile(profiles, pl.platform)?.id;
      if (!profileId) continue;
      try {
        const raw = await client.listComments(post.id, profileId);
        const list = (Array.isArray(raw) ? raw : raw?.data || raw?.comments || []).map(normalizeComment).filter(Boolean);
        for (const c of flatten(list, post.id)) all.push({ ...c, mine: c.mine || (c.author ? mine.has(String(c.author).toLowerCase().replace(/^@/, "")) : false), platform: pl.platform, profileId, postUrl: pl.url || null, campaign: post.campaign || null });
      } catch (error) {
        errors.push(`${post.id}/${pl.platform}: ${error.message}`);
      }
    }
  }

  const fresh = all.filter((c) => !c.mine && !seen.comments[c.id]);
  log(`${all.length} comment(s) on ${posts.length} post(s); ${fresh.length} new`);

  let chats = [];
  if (includeDms) {
    for (const p of profiles.filter((pr) => pr.platform === "instagram" || pr.platform === "facebook")) {
      try {
        const raw = await client.listChats(p.id);
        for (const chat of Array.isArray(raw) ? raw : raw?.data || []) {
          const lastId = chat.last_message?.id || chat.last_message_id || null;
          const inbound = chat.last_message ? !(chat.last_message.is_outbound || chat.last_message.direction === "outbound" || chat.last_message.from_profile) : Boolean(chat.unread_count);
          chats.push({ id: chat.id, profileId: p.id, platform: p.platform, participant: chat.participant_username || chat.participant?.username || chat.participant_external_id || null, lastMessageId: lastId, lastMessage: chat.last_message?.body || chat.last_message?.text || null, inbound, unread: chat.unread_count || 0, isNew: Boolean(lastId && inbound && !seen.messages[lastId]), raw: chat });
        }
      } catch (error) {
        errors.push(`chats/${p.platform}: ${error.message}`);
      }
    }
  }

  if (markSeen) {
    const now = new Date().toISOString();
    for (const c of fresh) seen.comments[c.id] = now;
    for (const ch of chats) if (ch.isNew) seen.messages[ch.lastMessageId] = now;
    saveSeen(tenant.slug, seen);
  }
  return { posts, comments: { new: fresh, all }, chats, errors };
}

/** Engagement: per-post stats for our posts plus per-profile account stats. */
export async function pullStats({ tenant, client = createClient() }) {
  const { posts } = await ourPosts({ tenant, client });
  const profiles = await client.listProfiles();
  const out = { posts: [], profiles: [], errors: [] };
  const ids = posts.map((p) => p.id);
  if (ids.length) {
    try {
      const raw = await client.postStats({ postIds: ids });
      out.posts = Array.isArray(raw) ? raw : raw?.data || raw?.stats || [];
    } catch (error) { out.errors.push(`post stats: ${error.message}`); }
  }
  for (const p of profiles) {
    if (tenant.postproxy?.profileIds?.length && !tenant.postproxy.profileIds.includes(p.id)) continue;
    try {
      const raw = await client.profileStats(p.id);
      const rec = raw?.records?.at?.(-1) || raw?.data?.records?.at?.(-1) || (Array.isArray(raw) ? raw.at(-1) : raw?.data || raw);
      out.profiles.push({ id: p.id, name: p.name, platform: p.platform, recordedAt: rec?.recorded_at || null, stats: rec?.stats || rec });
    } catch (error) { out.errors.push(`${p.platform} profile stats: ${error.message}`); }
  }
  return out;
}

export async function reply({ tenant, client = createClient(), postId, profileId, commentId, text, by = "human" }) {
  const result = await client.createComment(postId, profileId, { body: text, parentId: commentId });
  logAction(tenant.slug, { action: "reply", by, postId, profileId, commentId, text, resultId: result?.id || null, status: result?.status || null });
  return result;
}

export async function hide({ tenant, client = createClient(), postId, profileId, commentId, by = "human" }) {
  const result = await client.hideComment(postId, profileId, commentId, true);
  logAction(tenant.slug, { action: "hide", by, postId, profileId, commentId });
  return result;
}

export async function dm({ tenant, client = createClient(), chatId, text, by = "human" }) {
  const result = await client.sendMessage(chatId, { body: text });
  logAction(tenant.slug, { action: "dm", by, chatId, text, resultId: result?.id || null });
  return result;
}
