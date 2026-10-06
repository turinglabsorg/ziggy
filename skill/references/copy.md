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

- `media`: a variant name → its MP4, or its PNG when the variant is a slide; `<variant>-still` → its PNG;
  an array of those is an Instagram carousel (2–10 images, format `post`). An absolute path or https URL
  is used as is. Instagram always needs media. An X post always includes the image too: for a story
  that is `slide-cover` on the opening post. Do not publish a text-only thread, and do not put the reel
  there in place of the picture.
- `thread`: reply posts after the opening `body`. On X the URL goes in the last reply, never in `body`.
  The image stays on the opening post; the replies are text.
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
Put the readable domain in the video itself. Threads, Bluesky and LinkedIn make links clickable, so
those posts carry the URL in the text. X, through Postproxy, rejects a URL in the tweet body: put it
in `thread: [{ "body": "https://…" }]`, the reply, where the link is clickable. The tweet itself stays
link-free.

## Writing it

The tenant's `playbook.md` is the voice. For a launch: one idea per post, the URL on X in plain
text (it is the CTA), hashtags only on Instagram and few, alt text that describes what is in the
image (not the caption again), the first comment for the link or the "more" line. Keep the
language of the tenant (`tenant.json` → `language`) unless the campaign says otherwise.
