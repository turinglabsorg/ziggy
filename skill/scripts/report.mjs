/**
 * A one-shot tenant report: what went out, what's queued, the latest profile stats and the
 * inbox. `ziggy report <slug>` prints plain text on stdout — a scheduler pipes it wherever
 * (mail, grog telegram-send, a log). Numbers come from Postproxy; permalinks, never raw dumps.
 */
import { pullStats, pullInbox } from "./inbox.mjs";
import { createClient } from "./postproxy.mjs";
import { readPostLog } from "./config.mjs";

const STATS_KEYS = ["followers_count", "views_1d", "reach_1d", "total_interactions_1d", "views_7d", "reach_7d", "total_interactions_7d", "profile_views_7d"];

/**
 * The report as data + text. `statuses` comes from the tenant's post log refreshed against
 * Postproxy, one line per post: published with permalink, scheduled with its time.
 */
export async function buildReport({ tenant, client = createClient(), inboxNewOnly = true } = {}) {
  const [stats, inbox, statuses] = await Promise.all([
    pullStats({ tenant, client }),
    pullInbox({ tenant, client, markSeen: false }).catch((e) => ({ comments: { new: [], all: [] }, chats: [], errors: [e.message] })),
    refreshStatuses(tenant, client),
  ]);
  const lines = [];
  const errors = [...stats.errors, ...inbox.errors, ...(statuses.errors || [])];

  const published = statuses.posts.filter((p) => p.link);
  const queued = statuses.posts.filter((p) => !p.link && p.scheduledAt);
  if (published.length) lines.push("Published:", ...published.map((p) => `  ✓ ${p.campaign || p.id} → ${p.link}`));
  if (queued.length) lines.push("Scheduled:", ...queued.map((p) => `  ⏳ ${p.campaign || p.id} → ${p.scheduledAt}`));

  for (const p of stats.profiles) {
    const s = p.stats || {};
    const nz = STATS_KEYS.filter((k) => s[k]).map((k) => `${k.replace(/_count$/, "").replace(/_/g, " ")} ${s[k]}`);
    lines.push(`${p.platform} ${p.name}: ${nz.join(" · ") || "no stats yet"}${p.recordedAt ? ` (snapshot ${p.recordedAt})` : ""}`);
  }
  if (!stats.profiles.length) lines.push("(no profiles)");

  const fresh = inboxNewOnly ? inbox.comments.new : inbox.comments.all;
  const dms = inbox.chats.filter((ch) => !inboxNewOnly || ch.isNew);
  lines.push(`Inbox: ${fresh.length} comment(s)${dms.length ? `, ${dms.length} DM thread(s)` : ""}`);
  lines.push(...fresh.map((c) => `  💬 ${c.platform} @${c.author || "?"}: ${String(c.body || "").slice(0, 140)}`));

  const text = lines.join("\n") || "(nothing to report)";
  return { text, published, queued, profiles: stats.profiles, inbox: { comments: fresh, dms }, errors };
}

/** Every logged post, refreshed: status + permalink + scheduled time, in Postproxy when possible. */
async function refreshStatuses(tenant, client) {
  const logged = readPostLog(tenant.slug).filter((r) => r.postId);
  const errors = [];
  const posts = [];
  for (const r of logged) {
    let post = null;
    try { post = await client.getPost(r.postId); } catch (e) { if (!/404/.test(e.message)) errors.push(`${r.postId}: ${e.message}`); }
    if (!post) continue; // deleted posts simply drop out of the report
    const link = (post.platforms || []).find((pl) => pl.permalink)?.permalink || null;
    posts.push({ id: r.postId, campaign: r.campaign || null, status: post.status, link, scheduledAt: post.scheduled_at || null });
  }
  const order = (p) => (p.link ? 0 : 1);
  return { posts: posts.sort((a, b) => order(a) - order(b)), errors };
}
