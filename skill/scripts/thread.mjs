/**
 * A thread: the opening post (the cover image is attached by the caller), then replies.
 * X (through Postproxy) rejects a URL in the
 * opening post, so the story link is always its own last reply. Each part stays inside `limit`.
 */

export function splitText(text, limit) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];
  const parts = [];
  let rest = clean;
  while (rest.length > limit) {
    const atPeriod = rest.lastIndexOf(". ", limit - 1);
    const atSpace = rest.lastIndexOf(" ", limit);
    let cut;
    if (atPeriod >= Math.floor(limit * 0.4)) cut = atPeriod + 1;
    else if (atSpace >= 1) cut = atSpace;
    else cut = limit;
    const chunk = rest.slice(0, cut).trim();
    if (!chunk) break;
    parts.push(chunk);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** { body, thread: [{ body }] } from a title, a dek and an optional URL. */
export function composeThread({ title = "", dek = "", url = "", limit = 280 } = {}) {
  const posts = [...splitText(title, limit), ...splitText(dek, limit)];
  if (url) posts.push(String(url).trim());
  if (!posts.length) return { body: "", thread: [] };
  return { body: posts[0], thread: posts.slice(1).map((body) => ({ body })) };
}

/** Thread copy for a campaign: headline (or teaser), dek (or tagline), story URL if there is one. */
export function threadForCampaign(campaign, { limit = 280 } = {}) {
  const copy = campaign.copy || {};
  return composeThread({
    title: copy.headline || copy.teaser || "",
    dek: copy.dek || (copy.headline ? "" : copy.tagline || ""),
    url: campaign.story?.url || "",
    limit,
  });
}
