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

## Launch intro (`templates/hyperframes/intro`, 1080×1920, ~10s)

A launch video in the rhythm of a film-studio intro, made of the tenant's own story
illustrations and nothing but the brand: its colours, its fonts, its mark and its wordmark.
Never a borrowed logo box, red, or uppercase studio type (owner's call, 2026-10-10). Campaign
fields: `copy.tagline`, `copy.url`, `images` (about 16 story illustrations), `duration` (the
timing scales to it) and `audio.jingle` (one of the tenant's jingles).

- **Background**: the brand night, a radial `--card` → `--bg` (Ragusa's purple).
- **The wall**: four identical grids of 6 rows × 3 panels (700×394, 28px gaps, 16px radius,
  `--fg` hairline, no drop shadow), turned −45°, big enough to leave no gap in the frame. The
  panels are smaller than the 1024×576 illustrations, so they stay sharp. The timeline refills
  the grids' backgrounds as they take turns, and every image is preloaded so a cut never shows
  an empty panel.
- **Crescendo**: rows slide in from alternating sides, each page shorter than the last (from
  0.6s). After about two seconds hard cuts take over and tighten to ~15 a second, each grid
  snapping in sideways. Over the last ~3 seconds the pages come in fainter, travel further and
  fade under the next ones (ghost trails), while the wall blurs.
- **Brand from the first second**: mark (180px), wordmark in its own weights (Ragusa: "ragusa"
  300 + "buzz" 600, so the display face declares that range for this template), claim and url
  all appear as a ghost within a second (`data-layout-ignore`, so the contrast audit skips the
  deliberately faint stage). They firm up behind a growing scrim, then the real, audited text
  takes over as the last grid dissolves.
- **Any brand**: the wordmark is measured and shrunk at build time to fit the frame (an extended
  face in capitals like Alien Watch's Unbounded runs twice the width of a condensed one). Parts
  are trimmed and spaced 0.3em apart, and `wordmark.accentDot` is drawn outside the box so the
  word stays centred. The background card falls back to `--ink-raised`. A brand with a star
  field gets its sky behind the settled logo.

## Weekly events (`templates/hyperframes/eventi-settimana`, 1080×1920 and 1080×1350, 15–20s)

The week's events in the brand's night, as an agenda. Layout numbers live in
`TEMPLATE_VARIANTS["eventi-settimana"]` and reach the CSS as `--v-*` variables. Category chips use
the brand's own extra colours from `palette.raw` (`--sun`, `--hot`, `--lime`, `--sea`); no other
colour is added.

- **Safe area**: the same Reels bands as the story (`padTop` 250, `padBottom` 300, 110px sides);
  the post variant uses 70/80px.
- **Background**: `--bg` with two soft pools of `--card` and `--night-2`.
- **Intro (3s)**: the range as a filled accent chip («26 OTT – 1 NOV», mono), the title in the
  display face at 800 with the town word in accent, then the seven days as `--card` tiles, a dot
  under every day that has an event.
- **Cards (≈2.2s each)**: a header line (accent dot, «EVENTI · range», card counter) and a week
  strip whose bars light up under the card's days. The poster sits in a 26px-radius box over a
  blurred, darkened copy of itself (`object-fit: contain`, never cropped); the box takes the space
  the text leaves, up to `posterH`. Under it, the credit «Locandina: <fonte>» in small mono. Then
  the date chip (accent text on a 16% accent tint: it keeps its contrast while fading), the time,
  the title (display 720, balanced, three lines at most — the template shrinks it), the category
  as an outline chip in its brand colour, and «town · venue». A card without a poster gets a
  typographic panel: the day number huge in accent, month and weekday, the week strip.
- **Outro (3.5s)**: the range chip and the title again, a `--line` rule, the mark, «Tutti gli
  eventi:», the url big in accent with an underline (shrunk to fit one line), «Organizzi
  qualcosa? Proponilo sul sito» small. The last frame is the reel's cover (`snapshot` at the end),
  so it has to say which week it is.
- **Footer**: mark + wordmark, the url in mono, from the first second.
- **Rule**: dark text never sits on a bright chip that fades in — the contrast audit samples
  mid-fade. Bright colours carry the text themselves, on the night.

## Events teaser (`templates/hyperframes/eventi-teaser`, 13.5s)

The evergreen ad for the calendar: no dates, no titles, no posters. A 7×5 grid of day cells with
no numbers (the calendar motif) fills with dots in the brand colours, in a fixed shuffled order.
«Che si fa / a Ragusa?» (a one-letter word never ends a line), then «Il calendario di» with the
category words rolling through a mask (each in its colour), «In tutta la provincia» and a
full-bleed ticker of the towns, then «Aggiornato ogni giorno» while an accent ring runs across the
days, then the end card: the question again over a `--line` rule, the mark, «Tutti gli eventi
su», the url, «Organizzi qualcosa? Proponilo sul sito». Headings wrap balanced.

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
