# Source Feeds for Alien Watch

## News Stories

**Source**: Alien Watch Feed API  
**URL**: `https://alienwatch.buzz/feed/v1/briefings?lang=en&limit=50`

**Content**: Curated UFO/UAP news briefings from sources around the world
- Official government releases (AARO, Pentagon, NASA)
- Reputable media outlets covering UAP topics
- Scientific studies and observations
- Congressional hearings and FOIA releases

**Fields mapped**:
- `title` → headline
- `dek` → description
- `sector.name` → section
- `storyDate` → publication date
- `imageUrl` → hero image (rewritten to https://alienwatch.buzz/assets/)
- `slug` → unique identifier
- `sourceCount` → number of sources backing the story
- `languageCount` → available translations

## Case File Candidates

**Source**: Manual curation (round points JSON)  
**Future**: Configured source feeds in `tenant.json → casefile.sources`

**Content**: Sourced UAP facts from:
- **FOIA releases**: AARO, Pentagon records via FOIA requests
- **Official archives**: PURSUE (war.gov/UFO), National Archives
- **Research outlets**: The Black Vault, Dark Files, reputable UAP researchers
- **Verified media**: IBTimes UK, La Repubblica, major outlets with UAP coverage

**Requirements for inclusion**:
1. Must have verifiable source with URL
2. Official documentation or reputable outlet
3. Clear distinction between confirmed facts and speculation
4. No third-party video re-uploads
5. Public-domain or our own created media only

## Current Workflow

1. **News**: Automatically fetched from alienwatch.buzz feed API
2. **Case Files**: Manually curated and included in round points JSON
3. **Alternating**: Configurable ratio (default 1:1) interleaves the two formats
4. **Priority**: News is never dropped; case files fill the pattern

## Example Sources Referenced in Tests

From `examples.md`:
- **FOIA 26-F-1892**: Dark Files / The Black Vault  
  https://darkfires.org/aaro-foia-five-uap-cases-luna-september-2026/
- **PURSUE releases**: IBTimes UK, Le Figaro  
  https://www.ibtimes.co.uk/pentagon-releases-155000-pages-ufo-documents...
- **AARO assessments**: Official Pentagon publications

## Configuration

```json
{
  "feed": {
    "url": "https://alienwatch.buzz/feed/v1/briefings?lang=en&limit=50"
  },
  "casefile": {
    "enabled": true,
    "mode": "alternate",
    "ratio": { "news": 1, "casefile": 1 },
    "sources": []
  }
}
```

Future enhancement: `sources` array will support automated case file candidate discovery from configured feeds/URLs.
