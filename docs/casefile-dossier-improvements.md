# Case File DOSSIER Template Improvements

**Date:** October 15, 2026  
**PR:** [#9](https://github.com/turinglabsorg/ziggy/pull/9)  
**Branch:** `cursor/improve-casefile-dossier-ff78`

## Problem Statement

The original `casefile-dossier` template had readability and layout issues:
- Text was too small (headline 48px, dek 22px, points 20px)
- Fixed positioning left ~60% of the sheet empty
- No support for photos to illustrate case files
- Content could overflow with longer headlines

## Solution

### 1. Increased Text Sizes (~40%)

| Element | Before | After | Increase |
|---------|--------|-------|----------|
| Headline | 48px | 66px | +37.5% |
| Dek | 22px | 30px | +36.4% |
| Section Labels | 16px | 22px | +37.5% |
| Points | 20px | 28px | +40% |
| Source | 15px | 20px | +33.3% |

### 2. Flow Layout Architecture

**Before:** Fixed absolute positioning with hardcoded top offsets
```css
#headline { position: absolute; top: 160px; }
#dek { position: absolute; top: 280px; }  /* __CF_DEK_TOP__ */
#points { position: absolute; top: 380px; }  /* __CF_POINTS_TOP__ */
```

**After:** Content column with natural flow
```css
#content { position: absolute; top: 160px; }
#headline { margin: 0 0 20px; }
#dek { margin: 0 0 28px; }
#points { margin: 0 0 0; }
#photo-wrapper { margin: 32px 0 0; }
```

**Benefits:**
- Longer headlines push dek down naturally
- Longer dek pushes points down
- Photo appears below points in free space
- No overlap or clipping

### 3. Photo Support with Tape Effect

When `campaign.image` is provided:

```javascript
{
  image: "https://example.com/photo.png",
  imageCredit: "Photo: Wikimedia Commons"
}
```

**Visual Design:**
- White border (12px padding) mimicking a print
- Slight rotation (-1.2deg) for authenticity
- Layered shadows for depth
- Four semi-transparent tape strips at corners (80px × 24px, rotated ±42deg)
- Credit line below photo (13px italic mono, right-aligned, #666)

**Layout Behavior:**
- Photo wrapper: `display: block` (with image) or `display: none` (without)
- Width: 680px (fits in 800px content area with margins)
- Positioned in flow after points
- Bottom redaction bars repositioned via `bottom` offset to avoid overlap

**Animation Sequence:**
1. Points fade in sequentially (2.8s, 3.4s, 4.0s)
2. Photo border scales up (4.5s)
3. Tape strips appear one by one (4.7s, 4.8s, 4.9s, 5.0s)
4. Credit fades in (5.1s)
5. Redaction bars overlay (4.8s, 5.0s, 5.2s)
6. Stamp slams on (5.6s)

### 4. Technical Implementation

**Modified Files:**

#### `skill/templates/hyperframes/casefile-dossier/sub.html.tpl`
- Added `#content` wrapper with flow layout
- Added photo HTML structure with tape divs
- Updated CSS to use margin-based spacing
- Added photo animation timeline code
- Repositioned redaction bars using `bottom` offset

#### `skill/scripts/video.mjs`
```javascript
// Updated TEMPLATE_VARIANTS
"casefile-dossier": {
  reel: { 
    rotation: 2.5, 
    cfHeadline: 66,        // was 48
    cfDek: 30,             // was 22
    cfLabel: 22,           // new
    cfPoint: 28,           // was 20
    cfSource: 20,          // new
    redact2Bottom: 220,    // new
    redact3Bottom: 160,    // new
    pad: 120 
  }
}

// Added replacements
.replace(/__CF_LABEL__/g, String(v.cfLabel ?? 22))
.replace(/__CF_SOURCE_SIZE__/g, String(v.cfSource ?? 20))
.replace(/__REDACT2_BOTTOM__/g, String(v.redact2Bottom ?? 220))
.replace(/__REDACT3_BOTTOM__/g, String(v.redact3Bottom ?? 160))
.replace(/__PHOTO_CREDIT__/g, escapeHtml(campaign.imageCredit || ""))
.replace(/__PHOTO_CREDIT_DISPLAY__/g, campaign.imageCredit ? "block" : "none")
```

#### `skill/scripts/casefile.mjs`
```javascript
// Added to campaign object
return {
  // ...
  image: item.image || null,
  imageCredit: item.imageCredit || null,
  // ...
};
```

**Removed Tokens:**
- `__CF_DEK_TOP__` - obsolete with flow layout
- `__CF_POINTS_TOP__` - obsolete with flow layout

**New Tokens:**
- `__CF_LABEL__` - Section label font size
- `__CF_SOURCE_SIZE__` - Source footer font size (renamed from conflicting `__CF_SOURCE__`)
- `__REDACT2_BOTTOM__` - Bottom offset for second redaction bar
- `__REDACT3_BOTTOM__` - Bottom offset for third redaction bar
- `__PHOTO_CREDIT__` - Photo credit text
- `__PHOTO_CREDIT_DISPLAY__` - CSS display value for credit (block/none)

### 5. Compatibility & Testing

**Backward Compatibility:**
✅ Casefile-radar template unaffected (uses different tokens)  
✅ Round/points JSON format unchanged  
✅ Label/stamp/status features preserved  
✅ Campaigns without `image` render as before (but with larger text)

**Test Coverage:**
- All existing unit tests pass
- Integration tests validated
- Three render scenarios verified:
  1. With photo + credit
  2. Without photo
  3. Long headline (100+ chars) + photo

**Test Artifacts:**
- `test-with-photo-frame300.png` - Standard layout with Grusch testimony photo
- `test-no-photo-frame300.png` - Clean layout without photo
- `test-long-headline-frame300.png` - Flow handling of long headline

## Usage Examples

### Basic Case File with Photo

```javascript
const item = {
  headline: "Grusch on Rogan: the claims vs. the record",
  dek: "On Joe Rogan #2560 (30 Sept), Grusch described a deadly UFO crash clash.",
  points: [
    {
      label: "WHAT HE SAID",
      text: "He said reptilian beings killed US personnel at a UFO crash site."
    },
    {
      label: "SECONDHAND",
      text: "He says he never saw them. Under oath in 2023: 'never seen anything personally.'"
    },
    {
      label: "NO EVIDENCE",
      text: "AARO's 2024 review found no verifiable evidence of recovered alien technology."
    }
  ],
  source: {
    outlet: "AARO · House Oversight",
    url: "aaro.mil"
  },
  status: "unverified",
  template: "casefile-dossier",
  image: "https://upload.wikimedia.org/wikipedia/commons/4/44/David_Grusch_testimony.png",
  imageCredit: "Wikimedia Commons"
};

await createCasefileCampaign(tenant, item);
```

### Case File without Photo

```javascript
const item = {
  headline: "Pentagon confirms aerial phenomena tracking",
  dek: "DoD acknowledges ongoing monitoring of unidentified objects.",
  points: [
    { label: "CONFIRMED", text: "Multiple radar systems tracked objects..." },
    { label: "INVESTIGATION", text: "AARO established to investigate..." },
    { label: "SIGNIFICANCE", text: "First official acknowledgment..." }
  ],
  source: { outlet: "DoD", url: "defense.gov" },
  template: "casefile-dossier"
  // No image or imageCredit - renders with white space
};
```

### Long Headline with Photo

```javascript
const item = {
  headline: "Pentagon official confirms unexplained aerial phenomena tracked over multiple military installations worldwide",
  dek: "Department of Defense spokesperson acknowledges ongoing monitoring.",
  points: [...],
  image: "https://example.com/photo.png",
  imageCredit: "Official DoD Photo",
  template: "casefile-dossier"
  // Headline flows across multiple lines, pushes content down
};
```

## Design Rationale

### Typography Scale
Font sizes chosen to maintain hierarchy while maximizing readability on mobile (1080×1920):
- **66px headline** fills ~3 lines for typical case file titles (40-60 chars)
- **30px dek** provides comfortable reading for 100-120 char summaries
- **28px points** ensures key facts stay legible at ~90 chars per point
- **22px labels** distinguishes sections without competing with points

### Flow vs. Fixed Layout
**Decision:** Flow layout preferred for case files because:
- Content length varies significantly (headlines: 30-100+ chars, points: 50-90 chars)
- Fixed positioning requires manual tuning per case
- Flow automatically adapts to content without overflow
- More maintainable as font sizes change

**Trade-off:** Photo position varies based on text length, but this is acceptable since:
- Photo serves illustrative role, not structural
- Variation keeps each card feeling unique
- Tape effect makes photo look "placed" rather than "designed"

### Photo Integration
**Approach:** Mimic a physical photo "taped" onto a declassified document:
- White border evokes instant film or archival prints
- Slight rotation suggests hand-placement
- Tape strips ground the photo in the document's tactile world
- Credit line provides attribution without disrupting aesthetic

**Constraints:**
- 680px width (840px content area - 2×60px margins - 2×20px safe space)
- Height auto-scales to maintain aspect ratio
- Positioned after points to preserve information hierarchy
- Hidden completely when not provided (not a placeholder)

### Animation Timing
Staggered reveals build narrative:
1. Document structure (0-1.8s): backdrop, sheet, header, label
2. Core content (1.8-4.0s): headline, dek, points
3. Evidence (4.5-5.1s): photo, tape, credit
4. Classification markers (4.8-5.6s): redaction bars, stamp
5. Branding (6.0-6.4s): source, footer

Total: ~7s for 3-point case file (matches `casefileDuration(3)`)

## Maintenance Notes

### Adding New Variants
To add post (4:5) or x (16:9) variants:

```javascript
// skill/scripts/video.mjs TEMPLATE_VARIANTS
"casefile-dossier": {
  reel: { ... },
  post: { 
    rotation: 1.5,
    cfHeadline: 58, 
    cfDek: 26, 
    cfLabel: 20, 
    cfPoint: 24, 
    cfSource: 18,
    redact2Bottom: 180,
    redact3Bottom: 120,
    pad: 100 
  },
  x: false  // or define 16:9 layout
}
```

### Adjusting Typography
All sizes controlled via `TEMPLATE_VARIANTS`:

```javascript
cfHeadline: 66,  // headline font size
cfDek: 30,       // dek font size
cfLabel: 22,     // section label size
cfPoint: 28,     // point text size
cfSource: 20     // source footer size
```

Safe ranges based on testing:
- Headlines: 58-72px (3-4 lines for 40-80 chars)
- Dek: 26-34px (2-3 lines for 100-150 chars)
- Points: 24-32px (2-3 lines for 80-100 chars)

### Photo Sizing
Current: 680px width, auto height
- Works for 4:3, 3:2, 16:9 landscape photos
- Tall photos (9:16, 3:4) may extend beyond sheet bottom
- Consider adding `max-height` if portrait photos are common

### Redaction Bar Positioning
Bars positioned from bottom to avoid photo overlap:

```javascript
redact2Bottom: 220,  // 48px (source) + 20px (margin) + 152px (space)
redact3Bottom: 160   // allows for two-line points above
```

Adjust if source footer moves or photo grows taller.

## Future Enhancements

### Short-term
- [ ] Add `data-layout-allow-overflow` for intentional masks (HyperFrames check requirement)
- [ ] Support portrait photo orientation with max-height constraint
- [ ] Add photo border color customization via tenant brand palette
- [ ] Test with very long points (>100 chars) to verify 2-line limit

### Medium-term
- [ ] Add casefile-dossier post (4:5) variant for Instagram feed
- [ ] Support multiple photos (carousel of evidence)
- [ ] Add tape color variations (aged yellow, transparent)
- [ ] Implement safe shrink fallback for extreme overflow cases

### Long-term
- [ ] Dynamic font scaling based on content length (CSS clamp)
- [ ] Photo position variations (left/right/center)
- [ ] Redacted text effect for sensitive portions of points
- [ ] Animated typewriter effect for headline reveal

## References

- Original issue: User-provided screenshot showing small text and empty space
- Test data: `test-casefile-dossier.mjs`
- Example image: Wikimedia Commons David Grusch testimony photo (public domain)
- HyperFrames docs: https://hyperframes.dev/docs
- Ziggy operating rules: `/workspace/AGENTS.md`

## Related Documentation

- [Case File Campaign Format](./casefile-format.md) - JSON structure and validation rules
- [HyperFrames Template Guide](./hyperframes-templates.md) - Token replacement system
- [Video Rendering Pipeline](./video-rendering.md) - Scaffold, render, and publish flow
- [Brand Configuration](./brand-config.md) - Typography and palette customization
