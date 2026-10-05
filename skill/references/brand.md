# Brand

`ziggy brand extract <slug>` reads the tenant's site (HTML + first-party CSS) and writes
`brand.json`: a starting point, not a verdict. Open it, fix what the heuristics got wrong, commit.
After that the file is the source of truth and nothing re-extracts unless you pass `--force`.

## brand.json

| Field | Meaning | Extractor source |
|-------|---------|------------------|
| `name` | brand name as written | wordmark text, else `<title>` |
| `tagline` | one sentence under the wordmark | `<meta name="description">` — translate/rewrite it if the social language differs |
| `palette.bg/fg/muted/line/accent` | the five roles every template uses | `:root` CSS variables; names like `--hair`, `--accent`, `--muted` win over luminance guesses |
| `palette.raw` | every color variable found | for reference |
| `fonts.display/text/mono` | `{ family, weights }` | CSS variables `--display/--text/--mono`, the Google Fonts `<link>`, `body` font |
| `wordmark.parts` | `[{ text, weight }]` | element with class wordmark/logo/brand; `<b>` marks the heavy part |
| `wordmark.transform/letterSpacing/accentDot` | how the wordmark is set | `.wordmark` CSS; `accentDot` when the site draws a dot/moon next to it |
| `mark.svg` | a vector mark | the favicon when it is an inline SVG; otherwise `mark.url` |
| `stars` | sparse star field in backgrounds | the site's `radial-gradient(1px …)` pattern |

A site with no SVG favicon gets a monogram mark (initials of the wordmark parts). Replace
`mark.svg` with the real logo's SVG when you have it.

## Fonts

`ziggy brand fonts <slug>` downloads each family from Google Fonts as a variable woff2 into
`~/.ziggy/tenants/<slug>/brand/fonts/`. Templates copy them into every project and declare
`@font-face` with the weight range, which keeps `hyperframes check` happy (no remote fonts, no
`font_family_without_font_face`). A family that is not on Google Fonts: drop the `.woff2` into that
folder by hand, named `<FamilyWithoutSpaces>.woff2`.

## Identity assets

`ziggy assets <slug>` renders:

- `<slug>-profile-1000.png`, `<slug>-profile-400.png` (+ `<slug>-profile.svg` when a vector mark exists) — sized to survive the circular crop
- `<slug>-x-header-1500x500.png`, `<slug>-x-header-3000x1000@2x.png` — wordmark + tagline, text kept out of the bottom-left where X overlays the avatar

They are static one-second HyperFrames compositions captured with `hyperframes snapshot`, so the
look matches the videos exactly.
