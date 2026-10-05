---
name: ziggy
description: Per-tenant social media manager. Use when the user wants to launch or run a brand's social presence — extract a brand from a site, make profile/header images, produce short HyperFrames videos (reel, X, feed), write and publish posts through Postproxy, read comments/DMs/stats, answer comments, or schedule the autopilot. Triggers on "post this", "publish on X/Instagram", "social launch", "reel", "cover image", "answer the comments", "how are the posts doing", "ziggy", or any tenant name configured in ziggy (e.g. alienwatch).
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
| 6. Publish | `ziggy post <slug> <name>` (drafts) → `ziggy publish <slug> <ids>` or `ziggy post … --live` | Postproxy posts, permalinks in `ziggy status` |
| 7. Listen | `ziggy inbox <slug>` · `ziggy stats <slug>` | new comments, DM threads, engagement |
| 8. Answer | `ziggy reply …` · `ziggy hide …` · `ziggy dm …` · `ziggy autopilot <slug>` | replies per the tenant playbook |
| 9. Schedule | `ziggy watch <slug> --install --interval 900` | launchd/cron job running the autopilot |

Read the reference for the step you are on — `references/tenants.md`, `brand.md`, `video.md`,
`copy.md`, `postproxy.md`, `autopilot.md` — not all of them.

## Rules

1. **Keys never pass through you.** Ziggy reads `POSTPROXY_API_KEY` from the environment or
   wraps itself in `hush run`. When a tenant has no key: ask the user to share it as a Bitwarden
   Send and run `ziggy keys pull <slug> --send <url>`. Never paste, print, or look for a key
   value. `ziggy keys status <slug>` tells you whether one is stored, by name.
2. **Drafts first.** `ziggy post` creates drafts. Show the user the copy (`ziggy copy`) and the
   renders, get a yes, then `ziggy publish`. Use `--live` only when the user said to publish
   directly in this conversation.
3. **Edit definitions, not outputs.** Change `brand.json` / `campaign.json` / `playbook.md` in
   `tenants/<slug>/` and re-run the command. Generated HyperFrames projects under
   `~/.ziggy/tenants/<slug>/videos/` are overwritten on the next `ziggy video`.
4. **One tenant per command.** Never mix tenants' assets, copy or keys. The slug is the first
   positional argument everywhere.
5. **Autopilot acts only within the playbook.** In `draft` mode it proposes (see `ziggy queue`);
   in `auto` mode it replies/hides and logs every action (`ziggy actions`). Anything legal,
   press, money or unclear is escalated to the queue. Review the queue with the user.
6. **Instagram links are not clickable** in captions or comments. Story posts ask people to comment
   LINK; the autopilot DMs the URL (`linkReply`). Keep "link in bio" true: the bio must point at the site.
7. **Report with permalinks and numbers**, never with raw API dumps. `ziggy status`, `ziggy stats`
   and `ziggy inbox` already format them.

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
ziggy video alienwatch story-… --variants reel
ziggy post alienwatch story-… --live --only instagram_reel --watch
```

Daily run on an existing tenant:
```bash
ziggy inbox alienwatch && ziggy stats alienwatch
ziggy autopilot alienwatch --dry-run                    # what it would do
ziggy queue alienwatch                                  # what it left for a human
```

Hand the loop to the machine: `ziggy watch alienwatch --install --interval 900` after setting
`autopilot.mode` to `auto` in `tenant.json` and reading `references/autopilot.md`.

## Where things are

```
<repo>/tenants/<slug>/          versioned definition (tenant.json, brand.json, playbook.md, campaigns/<name>/campaign.json)
~/.ziggy/config.json            repo path, HyperFrames version
~/.ziggy/tenants/<slug>/        work: brand/fonts, assets/, videos/<campaign>/<variant>/ (HyperFrames projects), renders/, inbox/, posts.jsonl
hush: ziggy.<slug>.postproxy    the Postproxy key, by name
```
