---
name: ziggy
description: Per-tenant social media manager. Use when the user wants to launch or run a brand's social presence — extract a brand from a site, make profile/header images, produce short HyperFrames videos (reel, X, feed), Instagram photo carousels, and X text threads, write and publish posts through Postproxy, read comments/DMs/stats, answer comments, or schedule the autopilot, or run a publishing round for a news tenant (`ziggy round`). Triggers on "post this", "publish on X/Instagram", "social launch", "reel", "carousel", "thread", "cover image", "answer the comments", "how are the posts doing", "run a round", "giro", "ziggy", or any tenant name configured in ziggy (e.g. alienwatch).
---

# Ziggy

Ziggy runs a brand's social accounts end to end, one **tenant** at a time. Every step is a CLI
command that prints to stdout (`--json` for machine-readable output); you orchestrate, Ziggy
executes. The tenant is always explicit — nothing is global.

```bash
ziggy doctor <tenant>                 # start here: tools, brand, fonts, renders, key reachability
```

When working from the repo without installing: `node ziggy/skill/index.js …`.

## The pipeline

| Step | Command | Produces |
|------|---------|----------|
| 1. Tenant | `ziggy tenant add <slug> --name "…" --site https://…` | `tenants/<slug>/tenant.json`, `playbook.md` |
| 2. Brand | `ziggy brand extract <slug>` then `ziggy brand fonts <slug>` | `brand.json` (palette, fonts, wordmark, mark, tagline) + woff2 files |
| 3. Identity | `ziggy assets <slug>` | profile mark 1000/400 px, X header 1500×500 (+@2x) |
| 4. Campaign | `ziggy campaign add <slug> <name>` → edit `campaign.json`, or `ziggy story <slug>` for the latest story of a publishing tenant | copy + per-platform posts + variants |
| 5. Video | `ziggy video <slug> <name>` | HyperFrames projects, checked + rendered: reel 9:16, X 16:9, feed 4:5 + stills |
| 5b. Carousel | `ziggy slides <slug> <name>` | three feed stills (cover, dek, close) for an Instagram carousel |
| 5d. Events | `ziggy events <slug> --week [--from YYYY-MM-DD] [--publish] [--notify]` · `ziggy events <slug> --teaser` | the week's events reel (campaign `eventi-<monday>`, reel + post) or the evergreen events teaser; `--publish` posts the week's reel live on `daily.only` (Facebook through the Page guard, never twice); `ziggy serve` runs it weekly from `events.schedule` |
| 5c. Thread | `ziggy thread <slug> <name>` | X thread: cover image on the opening post, replies, the link in the last reply |
| 6. Publish | `ziggy post <slug> <name>` (drafts) → `ziggy publish <slug> <ids>` or `ziggy post … --live` | Postproxy posts, permalinks in `ziggy status` |
| 7. Listen | `ziggy inbox <slug>` · `ziggy stats <slug>` | new comments, DM threads, engagement |
| 8. Answer | `ziggy reply …` · `ziggy hide …` · `ziggy dm …` · `ziggy autopilot <slug>` | replies per the tenant playbook |
| 9. Schedule | `ziggy watch <slug> --install --interval 900` | launchd/cron job running the autopilot |

Read the reference for the step you are on — `references/tenants.md`, `brand.md`, `video.md`,
`copy.md`, `postproxy.md`, `autopilot.md`, `events.md` — not all of them.

## Rules

1. **Keys never pass through you.** Ziggy reads `POSTPROXY_API_KEY` from the environment or
   wraps itself in `hush run`. When a tenant has no key: ask the user to share it as a Bitwarden
   Send and run `ziggy keys pull <slug> --send <url>`. Never paste, print, or look for a key
   value. `ziggy keys status <slug>` tells you whether one is stored, by name.
2. **Drafts first.** `ziggy post` creates drafts. Show the user the copy (`ziggy copy`) and the
   renders, get a yes, then `ziggy publish`. Use `--live` only when the user said to publish
   directly in this conversation. The exceptions are `ziggy round` (below): it schedules live,
   and a tenant opts into that with a `daily.round` block in its `tenant.json`; and the weekly
   events reel, `ziggy events <slug> --week --publish`, which `ziggy serve` runs for a tenant
   with `events.schedule`.
3. **Edit definitions, not outputs.** Change `brand.json` / `campaign.json` / `playbook.md` in
   `tenants/<slug>/` and re-run the command. Generated HyperFrames projects under
   `~/.ziggy/tenants/<slug>/videos/` are overwritten on the next `ziggy video`.
4. **One tenant per command.** Never mix tenants' assets, copy or keys. The slug is the first
   positional argument everywhere.
5. **Autopilot acts only within the playbook.** In `draft` mode it proposes (see `ziggy queue`);
   in `auto` mode it replies/hides and logs every action (`ziggy actions`). Anything legal,
   press, money or unclear is escalated to the queue. Review the queue with the user.
6. **Story captions end with the full story URL.** Instagram captions are not clickable, but the
   reader can copy the link — no comment-LINK/DM flow, no first comment. Keep the bio pointing at
   the site.
7. **X posts always include the image.** The opening post carries the cover still (`slide-cover`,
   from `ziggy slides`). Never publish a text-only thread, and do not attach the reel instead of
   the picture. Replies stay text; the story URL is the last reply. Do not delete `media` to make
   a post go through. Run `ziggy slides` before `ziggy post` so the file exists.
8. **Report with permalinks and numbers**, never with raw API dumps. `ziggy status`, `ziggy stats`
   and `ziggy inbox` already format them.

## Running a round

A **round** is how an agent session publishes a news tenant's new stories. The session makes
one judgement per story, through the points file. Ziggy fixes everything else from
`tenant.json → daily`: the campaign, the jingle in rotation, the render, the check, the time and
the platforms. Two runs with the same feed and the same points file give the same result.

```bash
ziggy round <slug> --plan --json                     # 1. the stories still to do, with title, dek, deadline
# 2. write points.json (rules below)
ziggy round <slug> --points points.json --notify     # 3. campaigns → renders → checks → scheduled, summary to Telegram
ziggy round <slug> --points points.json --dry-run    #    or first see where each story would go (writes nothing)
```

`--plan` lists the stories that no live post or skipped campaign covers yet and that can still
go out, oldest first. Each one comes with its `prefix`, `title`, `dek`, `sources`, `image` and
`deadline`. With `freshness: "next-day"` a story goes out at the latest on the day after its date
(local news). With `"archive"` there is no deadline, and `--archive` lists older stories too.

The **points file** covers every story the plan listed, with no exceptions:

```json
{
  "scicli-collisione-frontale-nella-sera": [
    "A Scicli, domenica sera, due auto si sono scontrate frontalmente.",
    "L'incidente all'ingresso della città, sulla strada che arriva da Modica.",
    "Per una prima ricostruzione, non definitiva, un'auto avrebbe invaso la corsia opposta.",
    "Sulla dinamica indagano i Carabinieri."
  ],
  "skip": ["festa-patronale-sabato-sera"],
  "casefile": [
    {
      "headline": "AARO found the records. It released none.",
      "dek": "A FOIA reply tied to five cases on Rep. Luna's UAP list was withheld in full as classified.",
      "points": [
        "Per a Pentagon letter dated 30 Sept 2026 (FOIA 26-F-1892), published by researcher John Greenewald, AARO located responsive records and withheld them under national-security exemptions.",
        "This answers a FOIA request, not Congress. It does not show the task force was denied the same files.",
        "The videos are public for most cited cases, but the written reports that explain them are not."
      ],
      "source": {
        "outlet": "The Black Vault via Dark Files",
        "url": "https://darkfires.org/aaro-foia-five-uap-cases-luna-september-2026/"
      },
      "template": "casefile-dossier",
      "status": "withheld",
      "stamp": "WITHHELD IN FULL",
      "stampSub": "(b)(1) national security",
      "at": "2026-10-14T15:00:00.000Z"
    }
  ]
}
```

### Case Files (Alien Watch only)

The optional **`casefile`** array holds case file items. Case files can run in two modes:

**Fill mode** (default): Case files only added when the feed is thin, taking slots after news stories.

**Alternate mode**: Case files alternate with news according to a configurable ratio, while news is never dropped.

Configuration in `tenant.json`:
```json
{
  "casefile": {
    "enabled": true,
    "mode": "alternate",
    "ratio": {
      "news": 1,
      "casefile": 1
    },
    "sources": []
  }
}
```

- `mode`: `"fill"` or `"alternate"` (default: `"fill"`)
- `ratio`: When mode is `"alternate"`, defines the interleaving pattern (e.g., `1:1` alternates every other post, `2:1` puts 2 news posts for every 1 case file)
- `sources`: Array of source configurations for case file candidates (manual points in round for now)

Each case file is a sourced UAP fact followed by our perspective in three parts:

- **Confirmed** — what the source establishes
- **Not confirmed** — what it does not
- **Why it matters** — the significance

Rules:

- Exactly 3 points (Confirmed, Not confirmed, Why it matters), each ≤90 characters
- Points should NOT include the label prefixes ("Confirmed:", "Not confirmed:", "Why it matters:") — write them as plain statements; Ziggy strips any prefixes automatically
- Source must have `outlet` and `url`
- Optional `labels`: array of 3 custom section labels (e.g., `["VERIFIED", "DISPUTED", "IMPLICATIONS"]`) to replace the defaults
- Alternatively, points can be objects with `{ label?, text }` — when provided, `label` overrides the default for that point
- Optional `template`: `"casefile-dossier"` or `"casefile-radar"` (default: alternates based on persisted last-used template)
- Optional `status`: displayed status text in radar template (e.g., `"withheld"`, `"released"`, `"redacted"`, `"under review"`)
- Optional `stamp`: main stamp text for dossier template (e.g., `"WITHHELD IN FULL"`)
- Optional `stampSub`: subtitle for dossier stamp (e.g., `"(b)(1) national security"`); no stamp if both stamp fields are empty
- Optional `caseNum`: a case or document ID (e.g., `"26-F-1892"`)
- Optional `at`: ISO timestamp to schedule at a specific time (e.g., `"2026-10-14T15:00:00.000Z"`) instead of next free slot
- Keep source hedges; never upgrade claims or invent facts
- No re-uploads of others' videos (only official public-domain or our own card)
- Always ends pointing to alienwatch.buzz
- Templates alternate automatically (dossier/radar) across rounds when not explicitly set; last used template is saved in state

Example with custom labels:

```json
{
  "casefile": [
    {
      "headline": "New radar data analyzed",
      "dek": "Independent analysis suggests unusual characteristics",
      "labels": ["OBSERVATION", "ANALYSIS", "IMPACT"],
      "points": [
        "Multiple radar systems tracked the object simultaneously",
        "Speed calculations remain preliminary pending full data review",
        "If confirmed, would represent fastest recorded atmospheric transit"
      ],
      "source": {
        "outlet": "Aviation Analysis Weekly",
        "url": "https://example.com/radar-analysis"
      }
    }
  ]
}
```

Example with per-point label objects:

```json
{
  "casefile": [
    {
      "headline": "Document declassified",
      "dek": "Previously withheld report now public",
      "points": [
        { "label": "RELEASED", "text": "Report declassified on October 1, 2026" },
        { "label": "REDACTED", "text": "Three sections remain blacked out" },
        { "label": "SIGNIFICANCE", "text": "First official acknowledgment of the program" }
      ],
      "source": {
        "outlet": "Official Records",
        "url": "https://example.com/declassified"
      }
    }
  ]
}
```

In alternate mode, the round interleaves news and case files according to the ratio. News always takes priority: if there are more news items than the ratio allows, they all go out. Case files fill the pattern but don't block news.

How to write the points. These rules are fixed, so do not improvise.

- **4 points.** Write 3 only when the title and dek do not hold a fourth fact, and never invent one.
  Ziggy refuses anything other than 3–4 points, and any point over 90 characters.
- **One fact per point**, as a plain sentence. Read in order, the points tell the story: what
  happened (who, where, when), then the details, then what comes next.
- **Only what the title and dek say.** Copy numbers, names and places as written. Use no other
  source and no background of your own.
- **No adjectives of judgement, comments, questions, emojis, hashtags or calls to action.**
- **Keep the source's hedges** ("avrebbe", "secondo", "most likely"). An allegation never
  becomes a fact.
- **Write in the tenant's language** (`tenant.json → language`).

When to skip a story (list its prefix under `"skip"`; the skip is permanent):

- it announces an event, deadline or appointment that is already past, or will be by the time
  the story goes out;
- it is about minors involved in a crime, an accident or abuse;
- it rests on an unconfirmed allegation against an identifiable private person;
- it makes a private person in distress identifiable (a victim, an injured or sick person).

When in doubt, skip. Everything else goes out. Ziggy refuses some stories by itself: one with no
photo, one past its deadline, one already covered, one not in the feed. You do not need to skip
those.

Reading the result:

- Exit 0 means every story was scheduled. Exit 1 means the summary lists something to look at;
  it is printed (and sent with `--notify`) either way.
- Each scheduled story takes the next free `daily.round.times` slot, nearest deadline first, at
  least `gapMinutes` away from anything already queued, on every platform in `daily.only` whose
  Postproxy profile is active.
- `✗ … no audio` / `render failed` means the reel did not go out. Fix the cause and run the same
  points file again: covered stories are refused, never posted twice.
- `⚠️ non pubblicati su …` means a profile is disconnected on Postproxy. Tell the user, who has to
  reconnect it in the Postproxy dashboard.
- The check is mechanical: rendered, an audio track louder than −40 dB, at least 10 s. After a
  template change, look at a reel's still in `renders/<campaign>/` before trusting a round.

Run a round per tenant three times a day: morning, early afternoon and evening. A `next-day`
story waits at most one day.

**In production** Ziggy runs in the `ziggy-ziggy-1` Docker container. State lives in `/data`,
the keys are `POSTPROXY_API_KEY_<SLUG>`, and the Telegram target for `--notify` is set there too.
Run the same commands through `docker exec` and feed the points on stdin:

```bash
docker exec ziggy-ziggy-1 node skill/index.js round ragusa --plan --json
docker exec -i ziggy-ziggy-1 node skill/index.js round ragusa --points - --notify < points.json
docker exec ziggy-ziggy-1 node skill/index.js report ragusa       # what is published and queued
```

## Quick recipes

New brand, first post, same session:
```bash
ziggy tenant add nova --name "Nova" --site https://nova.example
ziggy brand extract nova && ziggy brand fonts nova     # then open tenants/nova/brand.json and fix what the extractor guessed
ziggy assets nova
ziggy campaign add nova first-post                      # edit copy in tenants/nova/campaigns/first-post/campaign.json
ziggy video nova first-post
ziggy post nova first-post                              # drafts → review → ziggy publish nova <ids>
```

The latest story as a reel (tenant.json → `feed` maps the site's feed):
```bash
ziggy stories alienwatch                                 # what the feed has, newest first
ziggy story alienwatch                                   # → campaign story-<date>-<slug> on the "story" template (kicker, headline, dek, image)
ziggy video alienwatch story-… --variants reel   # the video
ziggy slides alienwatch story-…                  # the carousel: cover, dek, close
ziggy thread alienwatch story-… --enable         # the thread; the cover image is on the first post, the link in the last reply
ziggy post alienwatch story-… --live --only instagram_reel --watch
```

The week's events as a reel (tenant.json → `events`; nothing is posted without `--publish`):
```bash
ziggy events ragusa --week --dry-run                    # the selection: chosen cards, the ones left out and why
ziggy events ragusa --week                              # campaign eventi-<monday>, posters, reel + post renders
ziggy events ragusa --week --from 2026-10-26            # a given week; exit 3 = fewer than events.minEvents, skipped
ziggy events ragusa --week --publish --dry-run          # + what would go out where (Facebook guard included), nothing posted
ziggy events ragusa --week --publish --notify           # render, publish live on daily.only, Italian summary via ZIGGY_REPORT_HOOK
ziggy events ragusa --teaser                            # the evergreen teaser (no dates), campaign eventi-teaser
```
`--publish` is idempotent: a platform with a live post of the week's campaign in posts.jsonl is
never posted again, so re-running it later only adds what the Facebook guard held. In production
`ziggy serve` runs it every Monday at 07:00 Rome (`events.schedule`); see `references/events.md`.

Daily run on an existing tenant:
```bash
ziggy daily ragusa --dry-run                           # preview: uncovered stories → scheduled slots
ziggy daily ragusa                                     # the real loop, once
ziggy report ragusa                                    # published/scheduled/stats/inbox as text
ziggy inbox alienwatch && ziggy stats alienwatch
ziggy autopilot alienwatch --dry-run                   # what it would do
ziggy queue alienwatch                                 # what it left for a human
```

Always-on: `ziggy serve <slug…>` re-runs daily + report on timers, and the weekly events job
(`events --week --publish --notify`) for tenants with `events.schedule`, even with `--no-daily`
(`--no-events` turns it off; GET /healthz shows its next run); the repo Dockerfile packages it
(`docker run -v ~/.ziggy:/data -e POSTPROXY_API_KEY_<SLUG> ziggy serve ragusa`).
For the inbox instead: `ziggy watch alienwatch --install --interval 900` after setting
`autopilot.mode` to `auto` in `tenant.json` and reading `references/autopilot.md`.

## Where things are

```
<repo>/tenants/<slug>/          versioned definition (tenant.json, brand.json, playbook.md, campaigns/<name>/campaign.json)
~/.ziggy/config.json            repo path, HyperFrames version
~/.ziggy/tenants/<slug>/        work: brand/fonts, assets/, videos/<campaign>/<variant>/ (HyperFrames projects), renders/, inbox/, posts.jsonl
hush: ziggy.<slug>.postproxy    the Postproxy key, by name
```
