# Zernio publishing

Select a publishing provider per tenant. Existing tenants keep Postproxy by default.

```json
{
  "publishing": { "provider": "zernio" },
  "zernio": {
    "accountIds": ["the-exact-connected-instagram-account-id"],
    "secretName": "ziggy.mybrand.zernio"
  }
}
```

`secretName` names a hush entry, never a key value. The default is
`ziggy.<slug>.zernio`; an explicitly authorized shared Zernio key may be named
instead. Zernio keys reach the child only as `ZERNIO_API_KEY`, through
`hush run --redact`. Container overrides use `ZERNIO_API_KEY_<SLUG>`.

Connect the intended Instagram Business/Creator account in Zernio first and pin
its exact account ID. No default account is selected. `ziggy profiles <slug>`
shows only pinned accounts; an empty list means none of the pinned accounts is
connected. Post status, publish, delete and reschedule also verify account ownership.

Supported commands:

```bash
ziggy keys status mybrand
ziggy doctor mybrand --no-probe
ziggy profiles mybrand
ziggy post mybrand campaign --only instagram_reel --dry-run
ziggy post mybrand campaign                        # drafts
ziggy publish mybrand <id> --watch                 # after approval
ziggy post mybrand campaign --live --watch         # direct publication when authorized
ziggy status mybrand <id>
ziggy reschedule mybrand <id> --at <future-ISO>
ziggy delete mybrand <id>                          # draft/scheduled only
```

The first adapter supports Instagram images, carousels, Reels and Stories, one
account per post. It preserves the campaign caption. A single video becomes a
Reel; Stories use `platformSpecificData.contentType=story`. Local files use
Zernio's presigned upload flow; the API authorization header is never sent to
storage. HTTPS media URLs skip upload.

Custom covers, first comments, collaborator/alt-text options, threads, other
platforms, inbox, statistics, autopilot and rounds are not supported by this
adapter yet. Unsupported options fail during preflight, including dry-runs;
unsupported commands refuse instead of falling back to Postproxy.

Create requests use a deterministic `Idempotency-Key`, based on target, caption,
format, media bytes and draft/schedule intent. Zernio retains idempotency keys
for 24 hours. After any ambiguous network failure, inspect remote status before
retrying. A published post cannot be published again through `ziggy publish`.
Only a published platform status and its permalink establish publication.

API references: [uploads](https://docs.zernio.com/guides/media-uploads),
[Instagram](https://docs.zernio.com/platforms/instagram/posts),
[create](https://docs.zernio.com/posts/create-post),
[update](https://docs.zernio.com/posts/update-post).
