# Tenants

A tenant is one brand with its own accounts, look, voice and key. Everything Ziggy does takes the
tenant slug first; nothing is shared between tenants.

## Two layers

| Layer | Path | Versioned | Holds |
|-------|------|-----------|-------|
| definition | `<repo>/tenants/<slug>/` | yes (git) | `tenant.json`, `brand.json`, `playbook.md`, `campaigns/<name>/campaign.json` |
| work | `~/.ziggy/tenants/<slug>/` | no | `brand/fonts/`, `assets/`, `videos/<campaign>/<variant>/`, `renders/<campaign>/`, `inbox/`, `posts.jsonl` |
| secret | hush `ziggy.<slug>.postproxy` | encrypted | the Postproxy API key |

The definition is enough to rebuild the work layer anywhere: `ziggy brand fonts`, `ziggy assets`,
`ziggy video` regenerate it. Delete `~/.ziggy/tenants/<slug>` freely; never delete the definition.

## tenant.json

```json
{
  "name": "Alien Watch",
  "site": "https://alienwatch.buzz/",
  "language": "en",
  "handles": { "twitter": "@alienwtch", "instagram": "@alienwatch" },
  "postproxy": { "profileGroupId": null, "profileIds": [] },
  "autopilot": { "mode": "draft", "dms": false, "maxPerRun": 10, "skipAuthors": ["alienwtch"], "escalateWords": ["press", "legal"], "agent": { "command": ["claude", "-p", "--output-format", "json"] } },
  "notes": "free text for humans and agents"
}
```

- `postproxy.profileGroupId` scopes profile lookup when one Postproxy account serves several brands.
  `profileIds` lets `inbox`/`stats` recognise posts made outside Ziggy.
- `autopilot` is documented in `autopilot.md`.
- `feed` (publishing tenants only) tells `ziggy story` where stories come from: `url`, `items`
  (dotted path to the array), `fields` (dotted paths for title, dek, section, date, image, slug,
  sources, languages), `imageRewrite` (regex → public asset host), `storyUrl` with `{slug}`,
  `displayUrl`. See `tenants/alienwatch/tenant.json` for a complete example.

## Commands

```bash
ziggy tenants
ziggy tenant add <slug> --name "…" --site https://… [--lang en]
ziggy tenant show <slug> [--json]
ziggy doctor <slug>
```

The slug is `[a-z][a-z0-9-]{1,40}`. It names the folder, the hush secret and the HyperFrames
projects, so pick it once.
