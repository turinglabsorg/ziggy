# Video

`ziggy video <slug> <campaign>` turns a template + the brand + the campaign copy into HyperFrames
projects, one per variant, and runs the HyperFrames pipeline on each: `check` (lint, runtime,
layout, motion, contrast) → `render` (H.264 MP4 + AAC) → `snapshot` of the final frame (PNG still,
used as reel cover and feed image).

```bash
ziggy video alienwatch first-post                 # all variants
ziggy video alienwatch first-post --variants x    # one
ziggy video alienwatch first-post --dry-run       # scaffold only, no check/render
ziggy video alienwatch first-post --quality draft # fast iteration
```

Outputs land in `~/.ziggy/tenants/<slug>/renders/<campaign>/` with a `manifest.json` that
`ziggy post` reads to find each platform's media.

## Variants

| name | canvas | layout | purpose |
|------|--------|--------|---------|
| `reel` | 1080×1920 | wordmark stacked | `instagram_reel` |
| `x` | 1920×1080 | wordmark on one line | `twitter` |
| `post` | 1080×1350 | stacked | `instagram_post` (video or still) |

Override or add variants in `campaign.json`:

```json
"variants": { "reel": { "mark": 160 }, "square": { "w": 1080, "h": 1080, "layout": "stacked", "mark": 140, "teaser": 44, "tag": 36, "tagMax": 760, "url": 30, "orbitK": 0.78, "stars": 30, "pad": 100 }, "post": false }
```

## Templates

`skill/templates/hyperframes/<template>/` holds `host.html.tpl` (the project's `index.html`, a
one-track host) and `sub.html.tpl` (the scene as a sub-composition). Placeholders are `__NAME__`
tokens filled from brand + campaign. The shipped template:

- **teaser** (7.5 s, logo-reveal category): star field → the accent dot orbits an empty centre →
  one teaser line → the wordmark reveals letter by letter through a mask → the dot lands beside
  the last letter → tagline → URL with an accent underline → hold. Optional deterministic ambient
  bed (`audio.bed`).

The projects follow the HyperFrames authoring contract (one paused GSAP timeline registered on
`window.__timelines[id]`, seek-safe tweens, no CSS/GSAP transform conflicts, `data-layout-allow-
overflow` on the mask wrappers, fonts shipped locally). Keep that contract when adding a template;
`ziggy video` refuses to render a project whose `check` fails.

## Editing a result

Open the project in HyperFrames Studio (`cd ~/.ziggy/tenants/<slug>/videos/<campaign>/<variant> &&
npx hyperframes preview`) to inspect; but make lasting changes in `campaign.json` / `brand.json` /
the template, then re-run `ziggy video` — generated projects are overwritten.

Requirements: Node 20+, ffmpeg, network for the first `npx hyperframes@<version>` download
(pinned in `~/.ziggy/config.json` → `hyperframesVersion`).
