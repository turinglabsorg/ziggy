# Postproxy

Ziggy publishes through Postproxy (https://postproxy.dev, API `https://api.postproxy.dev`). One
API key per tenant, held in hush as `ziggy.<slug>.postproxy`; profiles (connected accounts) are
resolved by platform, optionally inside a profile group.

## Key handling

```bash
ziggy keys status <slug>                       # stored? in env? — names only
ziggy keys pull <slug> --send <bitwarden-url>  # hush pull → ~/.hush/vault/ziggy.<slug>.postproxy.age
ziggy keys run <slug> -- post <slug> <campaign> --live   # explicit wrapping (automatic otherwise)
```

Every key-needing command checks `POSTPROXY_API_KEY`; absent, it re-executes itself under
`hush run --name ziggy.<slug>.postproxy --env POSTPROXY_API_KEY --redact`, so the value exists only
in the child process and hush redacts it from output. Never ask the user for the value: ask for a
Bitwarden Send link.

## Flow

```bash
ziggy profiles <slug>                 # GET /api/profiles — what is connected
ziggy post <slug> <campaign>          # POST /api/posts with post[draft]=true, multipart media
ziggy publish <slug> <id…> [--watch]  # POST /api/posts/:id/publish, then poll until published
ziggy post <slug> <campaign> --live   # create + publish; --at <ISO 8601> schedules instead
ziggy status <slug> [<id…>]           # GET /api/posts/:id → status + permalinks
```

Statuses: `draft → pending → scheduled → processing → processed`, with per-platform
`pending → published | failed`. `media_processing_failed` means a platform limit was hit — fix the
media, do not retry blindly. Postproxy retries platform rate limits itself.

## Engagement

```bash
ziggy inbox <slug> [--all] [--no-dms]   # GET /api/posts/:id/comments?profile_id=…  +  GET /api/profiles/:id/chats
ziggy stats <slug>                      # GET /api/posts/stats?post_ids=…  +  GET /api/profiles/:id/stats
ziggy reply <slug> <postId> <commentId> --text "…"      # POST /api/posts/:id/comments {body, parent_id}
ziggy hide  <slug> <postId> <commentId>                  # POST …/comments/:cid/hide
ziggy dm    <slug> <chatId> --text "…"                   # POST /api/chats/:id/messages
```

Comments are available on Instagram, Facebook, Threads, Bluesky, YouTube (LinkedIn coming). **X has
no comment API** — replies on X are out of reach for every tool built on Postproxy. Instagram DMs
honour the 24-hour window; a private reply to a commenter bypasses it once.

Rate limits: Instagram 100 posts per rolling 24 h per account.

## TikTok

The `tiktok` post kind (`format: video`, one mp4/mov/webm, 3 s–10 min, caption ≤ 2200) publishes the
same reel as Instagram. Defaults that matter: Postproxy sets `disable_comment/duet/stitch` to `true`
unless told otherwise — the story campaign template passes `disable_comment: false` explicitly.
`privacy_status` defaults to `PUBLIC_TO_EVERYONE`; on unaudited apps TikTok rejects public posts, but
profiles connected on/after 2026-09-30 (Business API) publish publicly. The tiktok entry in new story
campaigns is `enabled: false` until the tenant connects a TikTok profile. TikTok has no comment API
on Postproxy, so the comment-LINK → DM flow does not fire there; inbox/autopilot stay on Instagram.

Full reference, every platform in one file: https://postproxy.dev/postproxy-docs.md
