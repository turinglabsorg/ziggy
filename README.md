# ziggy

```
███████╗██╗ ██████╗  ██████╗ ██╗   ██╗
╚══███╔╝██║██╔════╝ ██╔════╝ ╚██╗ ██╔╝
  ███╔╝ ██║██║  ███╗██║  ███╗ ╚████╔╝
 ███╔╝  ██║██║   ██║██║   ██║  ╚██╔╝
███████╗██║╚██████╔╝╚██████╔╝   ██║
╚══════╝╚═╝ ╚═════╝  ╚═════╝    ╚═╝
```

A social media manager for coding agents, one tenant at a time. Ziggy takes a brand from its
website to its first post and keeps the accounts alive afterwards: brand tokens, profile and header
images, short videos rendered from HTML with [HyperFrames](https://github.com/heygen-com/hyperframes),
publishing through [Postproxy](https://postproxy.dev), an inbox of comments, DMs and stats, and an
autopilot that answers within a per-tenant playbook. Keys live in
[hush](https://github.com/turinglabsorg/hush), by name.

Named after the alien who became a star by broadcasting himself. Sits next to
[bowie](https://github.com/turinglabsorg) in the Turing Labs agent lab.

MIT. Open source at [github.com/turinglabsorg/ziggy](https://github.com/turinglabsorg/ziggy).

## What it does

```
site ──▶ brand.json ──▶ identity assets (profile, X header)
                   └──▶ campaign.json ──▶ HyperFrames projects ──▶ reel 9:16 · X 16:9 · feed 4:5 (+ stills)
                                                               └──▶ Postproxy drafts ──▶ publish ──▶ permalinks
accounts ──▶ inbox (comments, DMs, stats) ──▶ autopilot (playbook + agent) ──▶ replies / hides / queue for a human
```

Everything is per **tenant**: `tenants/<slug>/` in this repo holds the versioned definition
(`tenant.json`, `brand.json`, `playbook.md`, `campaigns/*/campaign.json`); `~/.ziggy/tenants/<slug>/`
holds the rebuildable work (fonts, renders, HyperFrames projects, inbox state); hush holds the key
as `ziggy.<slug>.postproxy`. Nothing is shared between tenants.

## Install

```bash
git clone https://github.com/turinglabsorg/ziggy.git
cd ziggy && sh skill/install.sh      # CLI → ~/.local/bin/ziggy, skill → ~/.codex/skills + ~/.claude/skills, config → ~/.ziggy
ziggy doctor
```

Requirements: Node 20+, ffmpeg, npm access for the pinned HyperFrames CLI (first run downloads
it), and [hush](https://github.com/turinglabsorg/hush) for keys. The coding agent (Claude Code or
Codex) picks up the `ziggy` skill on its next session.

## Use

```bash
# a new brand, first post
ziggy tenant add nova --name "Nova" --site https://nova.example
ziggy brand extract nova && ziggy brand fonts nova          # review tenants/nova/brand.json
ziggy assets nova                                            # profile 1000/400 + X header 1500×500 (+@2x)
ziggy campaign add nova first-post                           # edit copy in tenants/nova/campaigns/first-post/campaign.json
ziggy video nova first-post                                  # check + render + stills for reel, x, post
ziggy keys pull nova --send <bitwarden-send-url>            # the Postproxy key, into hush
ziggy post nova first-post                                   # drafts → review
ziggy publish nova <id> <id> <id> --watch                    # live, with permalinks

# the days after
ziggy inbox nova && ziggy stats nova
ziggy autopilot nova --dry-run                               # then: ziggy watch nova --install --interval 900
```

Every command prints human output by default and JSON with `--json`. Commands that need the key
(`post`, `publish`, `status`, `profiles`, `inbox`, `stats`, `reply`, `hide`, `dm`, `autopilot`)
wrap themselves in `hush run` when `POSTPROXY_API_KEY` is not already in the environment, so the
value exists only in the child process and never in a transcript.

## Repository

```
ziggy/
├── AGENTS.md / CLAUDE.md          operating rules for the coding agents working on this repo
├── README.md
├── bin/ziggy                      local wrapper → skill/index.js
├── ziggy.config.example.json      ~/.ziggy/config.json example
├── tenants/
│   └── alienwatch/                first tenant: tenant.json, brand.json, playbook.md, campaigns/first-post/
└── skill/
    ├── SKILL.md                   skill entry point (Codex + Claude Code)
    ├── agents/openai.yaml
    ├── index.js                   CLI
    ├── install.sh
    ├── package.json
    ├── references/                tenants, brand, video, copy, postproxy, autopilot
    ├── scripts/
    │   ├── config.mjs             ~/.ziggy, tenants, campaigns, post log
    │   ├── secrets.mjs            hush integration (pull / run / status by name)
    │   ├── brand.mjs              site → brand.json; Google Fonts download
    │   ├── assets.mjs             profile mark + X header via HyperFrames snapshot + ffmpeg
    │   ├── video.mjs              template → HyperFrames projects; check / render / snapshot
    │   ├── bed.mjs                deterministic ambient audio bed (WAV)
    │   ├── postproxy.mjs          API client: posts, publish, stats, comments, DMs
    │   ├── publish.mjs            campaign → drafts → publish; validation against platform limits
    │   ├── inbox.mjs              comments + DMs + stats, seen-tracking, action log
    │   ├── autopilot.mjs          triage → agent decision → act per policy
    │   ├── watch.mjs              launchd / cron schedule for the autopilot
    │   └── doctor.mjs
    ├── templates/
    │   ├── hyperframes/teaser/    host + sub-composition templates (7.5 s logo reveal)
    │   └── social/                profile and header compositions
    └── test/                      node:test — mock Postproxy server, fake hush, fake agent, fixtures
```

## Development

```bash
cd skill
npm run check     # syntax
npm test          # 40 integration tests, no network: mock Postproxy on localhost, fake hush, fake agent, fake HyperFrames CLI
```

Rendering for real needs the HyperFrames CLI (`npx hyperframes@0.8.133`) and a Chromium it can
drive; `ZIGGY_HYPERFRAMES_BIN`, `ZIGGY_HUSH_BIN`, `ZIGGY_FFMPEG_BIN`, `ZIGGY_POSTPROXY_BASE_URL`,
`ZIGGY_HOME` and `ZIGGY_REPO` swap every external dependency in tests.

## Threat model

Ziggy never reads a secret value: `hush list` returns names, `hush run` injects the key into the
child process and redacts it from output. Posting goes to Postproxy over HTTPS with the key in the
Authorization header only. The autopilot acts only on comments on the tenant's own posts (and DMs
when enabled), never follows links, and escalates anything the playbook does not cover. What it
cannot protect: a process running as the same user with access to `~/.hush/identity`.

## License

[MIT](LICENSE). Copyright (c) 2026 Turing Labs.
