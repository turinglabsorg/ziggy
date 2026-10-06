# Alien Watch — editorial plan

Social cadence for the Alien Watch feeds, per tenant `alienwatch`. The site publishes one briefing
per day; social turns each briefing into one story campaign (`ziggy story` + `ziggy video` +
`ziggy slides` + `ziggy thread`).

## Cadence (from 2026 cadence studies, sources in the repo conversation)

Alien Watch is a news/publication account, not a brand: audiences expect frequency over polish,
but consistency beats volume — reach decays (~40% in 60 days) below 3 posts/week on Instagram.

- **X (@alienwtch):** 1 story thread per day, **14:00 UTC (10:00 ET)** — inside the strongest
  Tue–Thu 8–11 AM ET window. When two briefings drop the same day, the second goes out at
  17:00 UTC. Never more than 2 story posts/day; keep ≥2 h between posts. Replies (autopilot) are
  on top of this and drive more growth than extra posts.
- **Instagram (@alienwatch):** 4–5 feed posts/week, Reels-first (Buffer: the 3–5/week step is the
  biggest growth jump; 10+/week still wins reach but burns the backlog). Post at
  **19:00 UTC (3 PM ET)**, Reels preferred on Wed/Thu. Format per week: 3 reels + 1–2 carousels
  (carousel on the slower news days).
- Ramp-up week 1 (2026-10-06 → 2026-10-10) runs daily on both platforms to clear the backlog,
  then settles to 4–5/week on IG while X stays daily.

## Per-story pipeline (one command chain per briefing)

```bash
ziggy story alienwatch                       # newest feed item → campaign story-<date>-<slug>
ziggy video alienwatch story-… --variants reel
ziggy slides alienwatch story-…              # carousel stills — X thread cover depends on these
ziggy thread alienwatch story-… --enable
ziggy post alienwatch story-… --live --only twitter --at <14:00 UTC ISO>
ziggy post alienwatch story-… --live --only instagram_reel --at <19:00 UTC ISO>
```

The X opening post always carries the slide cover; the story URL is the last thread reply. On
Instagram the caption asks for LINK in comments → autopilot DMs the URL (`linkReply`); the bio
points at alienwatch.buzz, so "link in bio" stays true.

## Backlog (as of 2026-10-06)

| Story | Campaign | State |
|---|---|---|
| Enceladus lab, 2026-10-03 | story-2026-10-03-laboratory-experiments-suggest | published IG reel + X |
| Mars polar ice, 2026-10-05 | story-2026-10-05-mars-s-northern-polar | published IG carousel + X |
| 70 Ophiuchi planet, 2026-10-05 | story-2026-10-05-modelling-study-suggests-nearby | campaign ready, **not rendered** |
| MUFON MADAR network, 2026-10-04 | — | in feed, no campaign yet |
| Briefcase in New Jersey, 2026-10-04 | — | in feed, no campaign yet |
| US Navy UAP emails, 2026-09-29 | — | in feed, still current enough |
| Pentagon 5th batch, 2026-08-10 | — | stale, skip |
| Zurich × SETI chair, 2026-09-01 | — | dated, use only on a slow day |
| Pentagon archive bid, 2026-09-04 | — | dated, use only on a slow day |
| Enceladus microbes, 2026-10-02 | — | near-duplicate of the published 10-03 story, skip |

## Week 1 schedule (2026-10-06 → 2026-10-10)

| Day | Story | X thread 14:00 UTC | IG 19:00 UTC |
|---|---|---|---|
| Tue 10-06 | 70 Ophiuchi (backlog) | ✓ | reel |
| Wed 10-07 | MUFON MADAR (backlog) | ✓ | carousel |
| Thu 10-08 | Briefcase NJ (backlog) | ✓ | reel |
| Fri 10-09 | US Navy emails (backlog) | ✓ | reel |
| Sat 10-10 | freshest feed story of the day | ✓ | carousel |

From Sun 10-11: `ziggy stories alienwatch` each morning, one story/day, same windows. If the feed
has nothing new, rest on IG; on X fill with a Zurich/SETI or Pentagon-archive backlog story.

## Steady state

- Automation: `ziggy watch alienwatch --install --interval 900` handles replies/DMs; scheduling
  stays manual per story until the pipeline is proven.
- Review loop: `ziggy inbox`, `ziggy stats`, `ziggy queue` daily; weekly stats decide whether the
  14:00 / 19:00 UTC windows hold or slide toward the audience's own peak (IG Insights).
- One campaign per briefing; same story never re-posts on the same platform.
