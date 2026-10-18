/**
 * Facebook Page anti-spam guard.
 *
 * Meta throttles Pages that post too often: the Graph API answers code 368, subcode 1390008
 * ("You're temporarily blocked from this action… We limit how often you can post"). The block
 * is on the Page, not on the content — the same captions go out on Instagram — and every new
 * attempt while blocked is one more "too often". So the round:
 *   - puts at most `maxPerDay` Facebook posts on a local day, at least `minGapMinutes` apart
 *     (counting every Facebook post already queued or attempted, failed ones included);
 *   - after a 368 on any recent Facebook post, adds no Facebook post earlier than
 *     `pauseHours` after it.
 * Instagram (and every other kind) is untouched: the story still goes out, only without the
 * Facebook twin. Tunable per tenant with `tenant.daily.facebook` — the defaults apply otherwise.
 */
export const FB_DEFAULTS = { maxPerDay: 6, minGapMinutes: 150, pauseHours: 24 };

export function fbGuardConfig(tenant) {
  const f = tenant?.daily?.facebook || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    enabled: f.enabled !== false,
    maxPerDay: num(f.maxPerDay, FB_DEFAULTS.maxPerDay),
    minGapMs: num(f.minGapMinutes, FB_DEFAULTS.minGapMinutes) * 60_000,
    pauseMs: num(f.pauseHours, FB_DEFAULTS.pauseHours) * 3600_000,
  };
}

/** A Postproxy platform entry that failed on Meta's spam throttle. */
export function isSpamBlock(platformEntry) {
  if (!platformEntry || platformEntry.platform !== "facebook" || platformEntry.status !== "failed") return false;
  const d = platformEntry.error_details || {};
  return String(d.platform_error_code) === "368" || /temporarily blocked from this action/i.test(String(platformEntry.error || ""));
}

/**
 * The time of the latest 368 among the Facebook posts that were due in the last `lookbackMs`
 * (newest first, at most `maxChecks` reads). null when none, or when Postproxy cannot be read —
 * the cap and the gap still apply then.
 */
export async function lastSpamBlock(fbRows, client, { now = Date.now(), lookbackMs = 48 * 3600_000, maxChecks = 8 } = {}) {
  const due = fbRows
    .map((r) => ({ id: r.postId, t: Date.parse(r.scheduledAt || r.at || "") }))
    .filter((r) => r.id && r.t <= now && r.t > now - lookbackMs)
    .sort((a, b) => b.t - a.t)
    .slice(0, maxChecks);
  for (const r of due) {
    let post;
    try { post = await client.getPost(r.id); } catch { continue; }
    if ((post?.platforms || []).some(isSpamBlock)) return r.t;
  }
  return null;
}

/**
 * Pure: may a Facebook post go out at `t`? `fbTimes` are the times of the Facebook posts
 * already queued or attempted (this round's included), `dayOf(ms)` the tenant's local day.
 */
export function fbAllowed(t, { fbTimes, blockedAt, cfg, dayOf }) {
  if (!cfg.enabled) return { ok: false, reason: "disabled" };
  if (blockedAt != null && t < blockedAt + cfg.pauseMs) return { ok: false, reason: "pause" };
  if (fbTimes.some((x) => Math.abs(x - t) < cfg.minGapMs)) return { ok: false, reason: "gap" };
  const day = dayOf(t);
  if (fbTimes.filter((x) => dayOf(x) === day).length >= cfg.maxPerDay) return { ok: false, reason: "cap" };
  return { ok: true };
}
