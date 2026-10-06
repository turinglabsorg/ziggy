# Ragusa Buzz — editorial plan

Social for the tenant `ragusa` (ragusa.buzz — local news of the Ragusa province, Italian-first).
Platforms: **Instagram and TikTok only**, no X. Volume outlet: the feed produces several briefings
per day, and local news audiences expect frequency.

## Cadence

Start ramped, not full-throttle: **2 posts/day for the first two weeks, then 3/day** if the stats
hold. One briefing → one reel → posted on both IG and TikTok (same 1080×1920 render, same caption).

Daily slots (Europe/Rome):

| Slot | Time | Content |
|---|---|---|
| Morning | 08:30 (06:30 UTC) | overnight/breaking cronaca |
| Midday | 13:00 (11:00 UTC) | strongest story of the morning |
| Evening | 19:30 (17:30 UTC) | society/sport/culture, the shareable one |

Two slots on week 1–2 (midday + evening), the morning slot comes in at 3/day. Never back-to-back:
≥ 3 h between posts on the same platform.

Story pick order per day: Cronaca > Sport > Società > others; skip anything older than 48 h unless
the day is dry. On Sundays: one recap carousel of the week's top stories (optional, manual).

## Per-story pipeline

```bash
ziggy story ragusa --index <N>                      # N from `ziggy stories ragusa`
ziggy video ragusa story-… --variants reel
# posts.instagram_reel and posts.tiktok ship enabled together; the caption is Italian,
# CTA "link in bio", no comment-LINK hook in the caption (TikTok has no comment API on Postproxy)
ziggy post ragusa story-… --live --only instagram_reel --at <slot ISO>
ziggy post ragusa story-… --live --only tiktok --at <slot ISO>
```

## Analytics loop

`ziggy stats ragusa` pulls Postproxy profile + post stats (views_7d, reach, interactions; TikTok
needs the post's public ID, resolved asynchronously). Weekly review every Monday:

- rank the week's posts by views and interactions;
- compare slots (midday vs evening) and sections (cronaca vs sport vs società);
- adjust: move the evening slot ±1 h, swap formats (carousel vs reel), promote the sections that win.
Decisions go back into this file.

## Guardrails

- Drafts first on every new campaign until the pipeline is proven; scheduling is manual per week.
- Autopilot stays `draft`: proposes replies, a human approves from `ziggy queue`. Never auto-reply
  on crime/accident stories touching minors or investigations (see playbook.md).
- One campaign per briefing; the same briefing never posts twice on one platform.
