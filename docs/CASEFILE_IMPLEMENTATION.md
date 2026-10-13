# Case File Format - Implementation Summary

## ✅ Completed (Updated)

### 1. Two HyperFrames Templates Created

**Dossier Template** (`casefile-dossier`)
- Cream declassified document sheet on dark background
- 2.5° rotation for authentic document feel
- Redaction bars (3 bars at different positions)
- Orange "WITHHELD IN FULL" stamp with "(b)(1) national security"
- FOIA case number and date in header
- Three-part structure: Confirmed / Not confirmed / Why it matters
- Smooth animations: sheet appears, sections fade in sequentially
- Static preview: `docs/casefile-dossier-preview.html`

**Radar Template** (`casefile-radar`)
- HUD-style radar grid with concentric circles and crosshairs
- Orange blip marker at center with case ID and status
- Corner markers for frame aesthetic
- Three data readouts with animated progress bars (75%, 45%, 85%)
- Pulsing animations on blip
- Radar grid fades in and pulses subtly
- Static preview: `docs/casefile-radar-preview.html`

Both templates:
- Use Alien Watch brand colors (#ff5a1f accent, #07080b bg, #ece6da fg)
- Respect DESIGN.md safe areas (1080×1920 reel format)
- Local font files (Unbounded, Geist, Geist Mono)
- Template-specific tokens in video.mjs
- Alternate daily (template selection based on date)

### 2. Case File Logic (`casefile.mjs`)

Functions implemented:
- `campaignFromCasefile()` - Generate campaign from case file item
- `casefileDuration()` - Calculate duration (~25s for 3 points)
- `createCasefileCampaign()` - Create and save campaign
- `casefileEnabled()` - Check tenant config
- `getCasefileCandidates()` - Placeholder for future sourcing

Validation:
- Exactly 3 points required (Confirmed, Not confirmed, Why matters)
- Each point ≤90 characters
- Source outlet required
- Headline and dek required

### 3. Round Integration with Alternating Mode (NEW)

Modified `round.mjs`:
- Extended points file format to support `casefile` array
- Campaigns created for both stories AND case files
- **NEW: `interleaveNewsAndCasefiles()`** - Alternates news and case files by configurable ratio
- Two modes: "fill" (original) and "alternate" (new)
- Validation before rendering
- Combined rendering and scheduling with smart interleaving
- Summary includes case file count and mode/ratio

**Alternating Logic**:
- **Fill mode**: News first, then case files (original behavior)
- **Alternate mode**: Interleaves at ratio (e.g., 1:1, 2:1, 3:1)
- **News priority**: All news items always published
- **Flexible patterns**: Configurable ratio adapts to content mix

Points file format:
```json
{
  "story-prefix": [3-4 points],
  "skip": ["prefix"],
  "casefile": [
    { "headline": "...", "dek": "...", "points": [...], "source": {...} }
  ]
}
```

### 4. Configuration (Updated)

`tenants/alienwatch/tenant.json`:
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

**Modes**:
- `fill`: Original behavior (case files when feed is thin)
- `alternate`: Interleave with news at specified ratio

**Ratio**: `{ news: N, casefile: M }` creates N:M pattern
- `1:1` = alternating (news, case, news, case, ...)
- `2:1` = two news per case (news, news, case, ...)
- Any ratio supported

Ragusa: unchanged (no case file config)

### 5. Documentation (Updated)

Updated `skill/SKILL.md`:
- Case file format documented in "Running a round" section
- **NEW: Alternating mode explanation** with configuration examples
- Points file example with case file items
- Editorial rules (source first, 3 points, keep hedges, etc.)
- Mode comparison (fill vs alternate)
- Integration notes

**NEW: `docs/ALIENWATCH_SOURCES.md`**:
- Complete documentation of news feed source
- Case file candidate sources listed
- Example sources from tests
- Future automation plans

### 6. Testing (Updated)

New test file: `skill/test/casefile.test.mjs`
- 11 test cases covering all functionality
- Campaign generation, validation, template alternation
- Tenant config checks

Extended `skill/test/round.test.mjs`:
- 3 tests for round integration (was 2, +1)
- Valid case file processing
- Invalid case file validation
- **NEW: Interleaving logic test** (fill mode, 1:1, 2:1, news priority)

**All 117 tests pass** ✅ (was 116, +1 new test)

### 7. Template Variants

`video.mjs` additions:
```javascript
TEMPLATE_VARIANTS = {
  "casefile-dossier": {
    reel: { rotation: 2.5, cfHeadline: 48, cfDek: 22, ... }
  },
  "casefile-radar": {
    reel: { cfHeadline: 52, cfDek: 24, ... }
  }
}
```

New tokens:
- `__CF_CASE_NUM__`, `__CF_DATE__`, `__CF_SOURCE__`
- `__CF_CONFIRMED__`, `__CF_NOT_CONFIRMED__`, `__CF_WHY_MATTERS__`
- `__CF_HEADLINE__`, `__CF_DEK__`, `__CF_POINT__`
- `__ROTATION__`

## 📁 Files Changed (Updated)

**New files:**
- `skill/scripts/casefile.mjs` (190 lines)
- `skill/templates/hyperframes/casefile-dossier/host.html.tpl` (33 lines)
- `skill/templates/hyperframes/casefile-dossier/sub.html.tpl` (178 lines)
- `skill/templates/hyperframes/casefile-radar/host.html.tpl` (33 lines)
- `skill/templates/hyperframes/casefile-radar/sub.html.tpl` (166 lines)
- `skill/test/casefile.test.mjs` (122 lines)
- `docs/casefile-dossier-preview.html` (234 lines)
- `docs/casefile-radar-preview.html` (236 lines)
- `docs/CASEFILE_IMPLEMENTATION.md` (228 lines) **[UPDATED]**
- `docs/ALIENWATCH_SOURCES.md` (84 lines) **[NEW]**

**Modified files:**
- `skill/scripts/video.mjs` (+30 lines: template variants, tokens, formatDate import)
- `skill/scripts/round.mjs` (+109 lines: case file processing, interleaving logic) **[UPDATED +42 lines]**
- `skill/SKILL.md` (+73 lines: documentation with alternating mode) **[UPDATED +25 lines]**
- `tenants/alienwatch/tenant.json` (+8 lines: config with alternating mode) **[UPDATED +3 lines]**
- `skill/test/round.test.mjs` (+99 lines: integration and interleaving tests) **[UPDATED +35 lines]**

**Total: 1,823 lines added** (was 1,406, +417 lines for alternating mode)

## 🎯 Design Decisions (Updated)

1. **Template Alternation**: Alternates daily based on `Date.now() / 86400000 % 2` to provide visual variety without configuration

2. **No Image Required**: Case files can run without photos (unlike news stories), using just the template design

3. **Backward Compatible**: 
   - Existing points files work unchanged
   - `casefile` section is optional
   - Only processed when tenant enables it
   - Default "fill" mode preserves original behavior

4. **Validation First**: Case files validated before rendering to catch errors early

5. **News Priority**: All news items always published, regardless of mode or ratio

6. **Opt-in per Tenant**: Ragusa unchanged, Alien Watch enabled via config

7. **Flexible Alternating** (NEW):
   - Two modes: "fill" (original) and "alternate" (new)
   - Configurable ratio for precise content mix
   - News never dropped: excess news items still publish
   - Simple block-based interleaving algorithm

8. **Source Transparency** (NEW):
   - News feed clearly documented
   - Case file sources explicitly listed
   - Future automation path defined

## 🚀 Usage (Updated)

### Create a case file campaign manually:

```bash
# Create campaign JSON in tenants/alienwatch/campaigns/my-casefile/
node skill/index.js video alienwatch my-casefile --variants reel
```

### Include in a round (fill mode - original):

```json
// points.json
{
  "story-slug-1": ["point1", "point2", "point3"],
  "casefile": [
    {
      "headline": "Case headline",
      "dek": "Brief description.",
      "points": ["Confirmed", "Not confirmed", "Why matters"],
      "source": { "outlet": "Source", "url": "https://..." }
    }
  ]
}
```

```bash
node skill/index.js round alienwatch --points points.json --dry-run
```

### Include in a round (alternate mode 1:1):

With `tenant.json` configured for `"mode": "alternate"` and `"ratio": { "news": 1, "casefile": 1 }`:

```json
// points.json - same format
{
  "story-slug-1": ["point1", "point2", "point3"],
  "story-slug-2": ["point1", "point2", "point3", "point4"],
  "casefile": [
    { "headline": "Case 1", ... },
    { "headline": "Case 2", ... }
  ]
}
```

Output will interleave: story-1, case-1, story-2, case-2

### Configure alternating ratio:

**1:1** (default alternate):
```json
{ "casefile": { "mode": "alternate", "ratio": { "news": 1, "casefile": 1 } } }
```

**2:1** (two news per case file):
```json
{ "casefile": { "mode": "alternate", "ratio": { "news": 2, "casefile": 1 } } }
```

**3:1** (three news per case file):
```json
{ "casefile": { "mode": "alternate", "ratio": { "news": 3, "casefile": 1 } } }
```

## 📊 Example Output

From examples.md #1:

**Headline**: AARO found the records. It released none.

**Dek**: A FOIA reply tied to five cases on Rep. Luna's UAP list was withheld in full as classified.

**Points**:
1. ✅ Confirmed: Per a Pentagon letter dated 30 Sept 2026 (FOIA 26-F-1892), published by researcher John Greenewald, AARO located responsive records and withheld them under national-security exemptions.
2. ❓ Not confirmed: This answers a FOIA request, not Congress. It does not show the task force was denied the same files.
3. Why it matters: The videos are public for most cited cases, but the written reports that explain them are not.

**Source**: The Black Vault via Dark Files

## ✅ Requirements Met (Updated)

- [x] Two visual templates (Dossier + Radar) implemented
- [x] Templates alternate/rotate
- [x] Integrated into round flow
- [x] **NEW: Alternating mode with configurable ratio**
- [x] **NEW: News never dropped (priority guarantee)**
- [x] Opt-in per tenant (alienwatch enabled, ragusa unchanged)
- [x] Backward compatible points file format
- [x] Tests passing (117/117, +1 new test)
- [x] Documentation updated (including source feeds)
- [x] Sample renders possible
- [x] PR open against main
- [x] **NEW: Source feeds documented explicitly**

## 🔗 Pull Request

**PR #1**: https://github.com/turinglabsorg/ziggy/pull/1

Status: Draft, ready for review
Branch: `cursor/case-file-format-57dd`
Base: `main`

All commits pushed, tests passing, documentation complete, alternating mode implemented.
