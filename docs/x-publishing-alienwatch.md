# X (Twitter) Publishing for Alien Watch

## Overview

Alien Watch now publishes both news stories and Case File posts to X (Twitter) alongside Instagram Reels and TikTok. This document explains how X publishing is enabled and how the platform gating mechanism works.

## Configuration

### Tenant Settings (`tenants/alienwatch/tenant.json`)

```json
{
  "social": {
    "platforms": ["tiktok", "twitter"]
  },
  "daily": {
    "only": ["instagram_reel", "tiktok", "twitter"]
  }
}
```

- **`social.platforms`**: Array of extra post kinds to enable in campaign definitions (beyond the always-on `instagram_reel`)
- **`daily.only`**: Array of post kinds that will be scheduled by the daily/round publishing flows

## Platform Gating Mechanism

The codebase uses two levels of platform gating:

### 1. Campaign Post Definition (Code Level)

In `story.mjs` and `casefile.mjs`, each campaign defines its posts with an `enabled` flag:

```javascript
const extra = new Set(social.platforms || []);

posts: {
  instagram_reel: {
    // Always enabled (no explicit flag needed)
    body: caption,
    media: "reel",
    cover: true,
  },
  twitter: {
    body: thread.body,
    media: "slide-cover",
    thread: thread.thread,
    enabled: extra.has("twitter"),  // ← Gated by social.platforms
  },
  tiktok: {
    body: caption,
    media: "reel",
    enabled: extra.has("tiktok"),  // ← Gated by social.platforms
  }
}
```

### 2. Publishing Flow Filtering (Runtime Level)

In `publish.mjs`, the `publishCampaign` function filters posts:

```javascript
const entries = Object.entries(campaign.posts || {})
  .filter(([kind, spec]) => 
    spec && 
    spec.enabled !== false && 
    (!only?.length || only.includes(kind))
  );
```

The `only` parameter comes from `tenant.daily.only` in the round/daily flows.

## X Post Format

X posts for both news and Case Files follow this format:

1. **Cover image**: Uses `slide-cover` (PNG final frame from the reel)
2. **Thread structure**:
   - First tweet: Headline (for stories) or headline (for Case Files)
   - Middle tweets: Dek and content points
   - Final tweet: Full story URL (e.g., `https://alienwatch.buzz/#/b/story-slug`)
3. **Alt text**: Headline/title

Example thread for a news story:
```
Tweet 1: "Pentagon releases new UAP footage"
Tweet 2: "Three separate incidents captured by naval aircraft sensors."
Tweet 3: https://alienwatch.buzz/#/b/pentagon-releases-new-uap-footage
```

## Implementation Files

### Modified Files

1. **`tenants/alienwatch/tenant.json`**
   - Added `"twitter"` to `social.platforms`
   - Added `"twitter"` to `daily.only`

2. **`skill/scripts/story.mjs`**
   - Changed line 207: `enabled: extra.has("twitter")`
   - Previously: `enabled: false`

3. **`skill/scripts/casefile.mjs`**
   - Changed line 204: `enabled: extra.has("twitter")`
   - Previously: `enabled: false`

### Test Files

1. **`skill/test/story.test.mjs`**
   - Added: "campaignFromStory enables twitter when in social.platforms"

2. **`skill/test/casefile.test.mjs`**
   - Added: "campaignFromCasefile enables twitter when in social.platforms"

3. **`skill/test/round.test.mjs`**
   - Fixed: "casefile 'at' field is preserved through round execution" (proper client creation)

## Other Tenants

### Ragusa (Unchanged)

Ragusa continues to publish only to Instagram Reels and Facebook Reels:

```json
{
  "social": {
    "platforms": ["facebook_reel"]
  },
  "daily": {
    "only": ["instagram_reel", "facebook_reel"]
  }
}
```

Twitter and TikTok posts remain disabled (`enabled: false` in campaign definitions) because these platforms are not in `social.platforms`.

## Testing

### Manual Verification

```bash
# Test alienwatch posts
node -e "
import('https://alienwatch.buzz/').then(async () => {
  const { campaignFromStory } = await import('./skill/scripts/story.mjs');
  const { campaignFromCasefile } = await import('./skill/scripts/casefile.mjs');
  
  // Test with alienwatch config
  const tenant = { 
    social: { platforms: ['tiktok', 'twitter'] }
  };
  
  // Verify both enable twitter
  console.log('Story twitter:', story.posts.twitter.enabled);
  console.log('Casefile twitter:', casefile.posts.twitter.enabled);
})
"
```

### Automated Tests

```bash
cd skill
npm test -- --test-name-pattern="enables twitter"
```

Both story and casefile tests verify that twitter posts are enabled when `"twitter"` is in `social.platforms`.

## Scheduling Behavior

When a round runs for alienwatch:

1. **Campaign creation**: Both news and Case File campaigns have twitter posts defined with `enabled: true`
2. **Rendering**: All variants are rendered, including `slide-cover` (used for X)
3. **Publishing**: The round schedules posts to all platforms in `daily.only`: `["instagram_reel", "tiktok", "twitter"]`
4. **Postproxy**: Each platform post is created with the appropriate media and format

## Migration Notes

This change is **backward compatible**:

- Tenants without `"twitter"` in `social.platforms` continue to have X posts disabled
- The `enabled: false` hardcode was replaced with `enabled: extra.has("twitter")`, which defaults to `false` when the platform is not listed
- No database migrations or API changes required

## Future Considerations

To enable X for other tenants, add `"twitter"` to both:
1. `tenant.social.platforms` (enables in campaign definitions)
2. `tenant.daily.only` (schedules via daily/round flows)

To disable X for alienwatch, remove `"twitter"` from both arrays.
