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

## Studio intro (`templates/hyperframes/intro`, 1080×1920)

A launch video in the style of a film-studio logo, made from the tenant's own story
illustrations. Campaign fields: `copy.word` (the big word), `copy.sub` (the line under it, set
like "STUDIOS"), `copy.tagline`, `copy.url`, and `images` (around 16 story illustrations, in page
order, the last one ending under the pull-back).

- **Act 1, flipbook**: the illustrations as full-bleed pages in a red duotone (the image's
  luminosity over `--hot` → `--hot-deep`, via `background-blend-mode`, no filters). Each page
  falls toward the viewer (`rotationX` around its bottom edge), faster and faster, under a slow
  push in.
- **Act 2, pull-back**: the same pages keep cutting inside the letters of the word (text with
  `background-clip: text`) while the camera pulls back from 7× with a small rotation. The red
  gradient comes up behind.
- **Act 3, logo**: the letters turn `--fg` white, a 7px box draws itself edge by edge, the sub
  line flashes in (brightness and blur settle), then the tagline, then the url with an accent
  underline as wide as the text.
- **Red**: `--hot` comes from `brand.palette.raw["--hot"]` (Ragusa `#ff4d6d`), falling back to
  the accent. The gradient runs `--hot-mid` (18% darker) at the centre to `--hot-deep` (62%
  darker) at the edges, which keeps white type above 3:1.
- **Sound**: a named jingle outside the rotation (`ziggy jingle <slug> --name intro`): a
  12-second heroic orchestral fanfare whose hit lands on the white logo. It is described by
  style only, never by naming another studio's music. `audio.fadeOut` is short (0.8s) so the
  final chord rings out.

## Sound

Each tenant has a set of about five jingles, all composed by ElevenLabs Music from the same
`tenant.json → music.prompt`, so they share one style. They are instrumental, with a short motif
at the start that comes back, and they sit under on-screen text. Ragusa Buzz is a light, modern
news intro (no folk instruments, nothing pompous); Alien Watch is cinematic sci-fi. New stories
take the set in rotation. Every reel plays its jingle from the top, cut to the reel's length
with a 0.25s fade in and a 1.8s fade out. The synthesized bed (`bed.mjs`) is only the fallback
for a tenant without jingles.

## Rules learned the hard way

- A story whose image URL cannot be fetched must **fail** the render so the loop retries it. It
  must not render without the photo: a reel with an empty top band looks broken.
- Never add a full-width overlay to a scene to "help contrast". The text already sits on plain
  `--bg` below the photo. An overlay that covers part of the photo shows up as a hard band.
- Captions carry the story link. No "Comment LINK" call to action, on screen or in copy.
