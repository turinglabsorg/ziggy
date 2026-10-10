/**
 * A one-shot tenant report: what went out, what's queued, the latest profile stats and the
 * inbox. `ziggy report <slug>` prints plain text on stdout — a scheduler pipes it wherever
 * (mail, grog telegram-send, a log). Numbers come from Postproxy; permalinks, never raw dumps.
 */
import { pullStats, pullInbox } from "./inbox.mjs";
import { createClient } from "./postproxy.mjs";
import { readCreatedPosts } from "./config.mjs";

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

  // in time order: the log's order is creation order, and reschedules move posts around
  const when = (p) => String(p.scheduledAt || p.at || "");
  const byTime = (a, b) => when(a).localeCompare(when(b));
  const published = statuses.posts.filter((p) => p.link).sort(byTime);
  const queued = statuses.posts.filter((p) => !p.link && p.scheduledAt && p.status === "scheduled").sort(byTime);
  // one line per story and time: a reel going to Instagram and TikTok together is one slot
  const slots = queued.filter((p, i) => queued.findIndex((q) => q.scheduledAt === p.scheduledAt && q.campaign === p.campaign) === i);
  const tz = tenant.daily?.tz || "Z";
  const short = (name) => String(name || "").replace(/^story-\d{4}-\d{2}-\d{2}-/, "").replace(/-+$/, "").replace(/-/g, " ");
  const localTime = (iso) => {
    if (tz === "Z") return iso.slice(11, 16);
    const offsetMs = Date.parse("2000-01-01T00:00:00Z") - Date.parse(`2000-01-01T00:00:00${tz}`);
    return new Date(Date.parse(iso) + offsetMs).toISOString().slice(11, 16);
  };
  const now = new Date();
  lines.push(`📊 ${tenant.brand?.name || tenant.name} — ${localTime(now.toISOString())}${tz === "Z" ? " UTC" : ""}`);

  if (published.length) {
    const last = published[published.length - 1];
    lines.push(`✅ ${published.length} pubblicati — ultimo: ${short(last.campaign || last.id)}`);
    lines.push(`   ${last.link}`);
  }
  if (slots.length) {
    lines.push(`⏳ in programma:`);
    for (const p of slots.slice(0, 4)) lines.push(`   🕒 ${localTime(p.scheduledAt)} — ${short(p.campaign || p.id)}`);
    if (slots.length > 4) lines.push(`   …altri ${slots.length - 4}`);
  }

  for (const p of stats.profiles) {
    const s = p.stats || {};
    const parts = [];
    if (s.followers_count) parts.push(`${s.followers_count} follower`);
    if (s.views_1d) parts.push(`${s.views_1d} views/24h`);
    else if (s.views_7d) parts.push(`${s.views_7d} views/7gg`);
    if (s.reach_1d) parts.push(`reach ${s.reach_1d}`);
    else if (s.reach_7d) parts.push(`reach ${s.reach_7d}/7gg`);
    if (s.total_interactions_1d) parts.push(`${s.total_interactions_1d} interazioni`);
    lines.push(`📈 ${p.platform} ${p.name}: ${parts.join(" · ") || "ancora nessun dato"}`);
  }

  const fresh = inboxNewOnly ? inbox.comments.new : inbox.comments.all;
  const dms = inbox.chats.filter((ch) => !inboxNewOnly || ch.isNew);
  lines.push(fresh.length || dms.length
    ? `📥 inbox: ${fresh.length} ${fresh.length === 1 ? "commento" : "commenti"}${dms.length ? `, ${dms.length} DM` : ""} 👀`
    : `📥 inbox: niente di nuovo`);
  for (const c of fresh.slice(0, 3)) lines.push(`   💬 @${c.author || "?"}: ${String(c.body || "").slice(0, 100)}`);

  const text = lines.join("\n") || "(nothing to report)";
  return { text, published, queued, profiles: stats.profiles, inbox: { comments: fresh, dms }, errors };
}

/** Every logged post, refreshed: status + permalink + scheduled time, in Postproxy when possible. */
async function refreshStatuses(tenant, client) {
  const logged = readCreatedPosts(tenant.slug);
  const errors = [];
  const posts = [];
  for (const r of logged) {
    let post = null;
    try { post = await client.getPost(r.postId); } catch (e) { if (!/404/.test(e.message)) errors.push(`${r.postId}: ${e.message}`); }
    if (!post) continue; // deleted posts simply drop out of the report
    // removed by hand on the platform (Instagram/TikTok can't be deleted through the API)
    if ((post.platforms || []).length && post.platforms.every((pl) => pl.status === "deleted")) continue;
    const link = (post.platforms || []).find((pl) => pl.permalink)?.permalink || null;
    posts.push({ id: r.postId, campaign: r.campaign || null, status: post.status, link, scheduledAt: post.scheduled_at || null, at: r.at || null });
  }
  const order = (p) => (p.link ? 0 : 1);
  return { posts: posts.sort((a, b) => order(a) - order(b)), errors };
}
