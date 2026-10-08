# Ziggy design system

Ziggy has no UI of its own: what people see are the videos and stills it renders for each
tenant. Every template draws from the tenant's `brand.json`, never from hard-coded colors or
fonts. This file is the source of truth for how those renders are composed. Read it before
touching `skill/templates/`, and update it when a template gains a new pattern.

## Tokens (per tenant, from `brand.json`)

| Token | Role | ragusa | alienwatch |
| --- | --- | --- | --- |
| `--bg` | page background, every overlay tint | `#140c18` | `#07080b` |
| `--fg` | headline, body, url | `#fff6ea` | `#ece6da` |
| `--muted` | kicker, meta line | `#cbb8c4` | `#8c8678` |
| `--line` | footer rule, progress track | `#3a313a` | `#24231f` |
| `--accent` | kicker dot, point numbers, rules, url underline, progress | `#ffb703` | `#ff5a1f` |
| `--display` | headline, point text, numbers | Bricolage Grotesque | Unbounded |
| `--text` | dek (close slide) | Be Vietnam Pro | Geist |
| `--mono` | kicker, meta, url | Geist Mono | Geist Mono |

Fonts ship inside each HyperFrames project as local `woff2` files, never from a CDN.

## Story reel (`templates/hyperframes/story`, 1080×1920)

Layout numbers live in `TEMPLATE_VARIANTS.story` in `skill/scripts/video.mjs`.

- **Safe area**: nothing readable above `padTop` (250) or below `padBottom` (300). Instagram's
  own UI covers those bands.
- **Photo**: big, at the top. A full-width 1080×1000 box (`photoH`) with `object-fit: cover`.
  The landscape illustrations overflow sideways, so the photo pans from `object-position: 15%`
  to `85%` across the whole piece (sine in-out) on top of a slow 1.08→1.0 push. The centre is
  always in frame and almost the whole image is seen. It fades into `--bg` only through a mask
  on its last 38%, which keeps it clear of the text zone. One light shade gradient covers the
  whole photo. Nothing with a hard edge is ever drawn over it, and scene backgrounds must not
  tint part of it.
- **Kicker**: mono, uppercase, `kicker` px, `0.16em` tracking, accent dot. It sits inside the safe
  area, which means over the photo, so it always carries its own chip: a `--bg` plate at 0.78
  alpha, 10px radius. That keeps 3:1 contrast on any illustration without darkening the image.
- **Scenes** (bottom-aligned above the footer, one visible at a time):
  1. headline (display, `headline` px, word-by-word reveal);
  2. one slide per summary point: accent number (`headline × 1.15`), 72×3px accent rule,
     point text (display, `headline × 0.84`);
  3. end card, always last: the source count (display, `headline × 2.6`, accent) with its mono
     label ("fonti" / "sources"), then where to read the whole story ("Vai su ragusa.buzz per
     leggere tutta la notizia" / "Read the full story on alienwatch.buzz"), the site in accent.
- **Footer**: 1px `--line` rule on top. Brand mark (or wordmark) and the meta line ("2 fonti ·
  1 lingua") on the left; the site url in mono with an accent underline on the right. It is the
  only brand mention on screen.
- **Motion**: one paused GSAP timeline per composition. Title 5s, each point ≥3.6s, close 4s.
  The photo fades in and then pushes from 1.1 to 1.0 scale across the whole piece. The progress
  bar fills over the full duration.

## Rules learned the hard way

- A story whose image URL cannot be fetched must **fail** the render so the loop retries it. It
  must not render without the photo: a reel with an empty top band looks broken.
- Never add a full-width overlay to a scene to "help contrast". The text already sits on plain
  `--bg` below the photo. An overlay that covers part of the photo shows up as a hard band.
- Captions carry the story link. No "Comment LINK" call to action, on screen or in copy.
