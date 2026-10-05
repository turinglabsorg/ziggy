# Copy

Copy lives in `campaign.json` → `posts`, one entry per destination. `ziggy copy <slug> <campaign>`
prints every entry with its character count against the platform limit.

```json
"posts": {
  "twitter":         { "body": "…", "media": "x" },
  "instagram_reel":  { "body": "…", "media": "reel", "cover": true, "first_comment": "…" },
  "instagram_post":  { "body": "…", "media": "post-still", "alt_text": "…" },
  "instagram_story": { "body": "", "media": "reel", "enabled": false },
  "threads":         { "body": "…", "media": "post-still", "enabled": false }
}
```

- `media`: a variant name → its MP4; `<variant>-still` → its PNG; an absolute path or https URL
  is used as is. Instagram always needs media; X accepts text-only.
- `cover: true` on a reel uses the variant's still as cover (`cover: "<variant>-still"` or a URL
  to pick another).
- `platform: { … }` passes any extra Postproxy platform parameter through untouched.
- `enabled: false` keeps an entry in the file without posting it.

## Limits Ziggy checks before uploading

| kind | text | media |
|------|------|-------|
| twitter | 280 | 4 images ≤5 MB or 1 video ≤512 MB, 1–140 s |
| instagram_post | 2,200 | 1–10 images ≤8 MB or 1 video ≤300 MB, 3 s–60 min |
| instagram_reel | 2,200 | 1 video ≤300 MB, 3 s–90 min, 9:16 |
| instagram_story | — | 1 image ≤8 MB or 1 video ≤100 MB |
| threads | 500 | — |
| bluesky | 300 | — |
| linkedin | 3,000 | — |

A failed check stops the whole campaign before anything is created.

## Links on Instagram

Caption and comment URLs are plain text on Instagram. Write the CTA accordingly: "Comment LINK and
we'll send it to you" (the autopilot's `linkReply` rule does the sending, by DM), plus "link in bio".
Put the readable domain in the video itself. X, Threads, Bluesky and LinkedIn make links clickable, so
those posts carry the URL in the text.

## Writing it

The tenant's `playbook.md` is the voice. For a launch: one idea per post, the URL on X in plain
text (it is the CTA), hashtags only on Instagram and few, alt text that describes what is in the
image (not the caption again), the first comment for the link or the "more" line. Keep the
language of the tenant (`tenant.json` → `language`) unless the campaign says otherwise.
