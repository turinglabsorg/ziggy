# Autopilot

The inbox, answered. Each run pulls new comments (and inbound DMs when enabled) on the tenant's
posts, decides per item, acts within policy, and records everything.

```bash
ziggy autopilot <slug> --dry-run    # decide, post nothing, print the plan
ziggy autopilot <slug>              # act per tenant.json → autopilot.mode
ziggy queue <slug>                  # items left for a human (escalations, draft-mode proposals)
ziggy actions <slug>                # everything posted/hidden/skipped, by whom
ziggy watch <slug> --install --interval 900 | --status | --uninstall
```

## Decision order

1. **Triage without an agent**: author on `skipAuthors` → skip; any `escalateWords` hit → escalate;
   empty → skip; a comment that says LINK (or another `linkReply.keywords` word) on a post that
   carries a link → **link**: the URL goes to the commenter as a private reply (a DM, where links
   are clickable) and a short public ack is posted under the comment.
2. **Ask Jev** (when `autopilot.jev` is on): TypeSafe's Jev scores each remaining item on three
   atomic questions — does a person have to handle it, is it spam, would a reply add something —
   in about half a second and a few hundred tokens. Only sure answers act: `escalate ≥ 0.85` → the
   queue, `spam ≥ 0.9` → hide (a DM is skipped), `needs_reply ≤ 0.1` → skip. Everything else, and
   everything when Jev is unreachable or has no key, goes to the agent. Actions record `by: "jev"`.
3. **Ask the agent** with the playbook + the item. The agent is a command that reads the prompt on
   stdin and prints a JSON decision `{"action": "reply|skip|hide|escalate", "text": "…", "reason": "…"}`;
   the default is `claude -p --output-format json` (Claude Code headless). Codex, a local model or a
   script work the same way — set `autopilot.agent.command`.
4. **Act by mode**: `auto` posts replies / hides and logs; `draft` writes the proposal to the queue;
   `off` does nothing. Escalations always go to the queue. `maxPerRun` caps actions per run.

No agent configured (`"agent": null`) means every item is escalated: autopilot never improvises.

## Policy (tenant.json → autopilot)

```json
"autopilot": {
  "mode": "auto",
  "dms": true,
  "maxPerRun": 10,
  "skipAuthors": ["alienwtch", "alienwatch"],
  "escalateWords": ["legal", "lawyer", "refund", "press", "journalist", "lawsuit", "copyright", "dmca", "partnership", "sponsor"],
  "linkReply": { "keywords": ["link", "source", "sources", "fonte", "fonti"], "template": "Here is the full story, with sources: {url}", "ack": "Sent — check your DMs." },
  "agent": { "command": ["claude", "-p", "--output-format", "json"], "timeoutMs": 120000 },
  "jev": true
}
```

`jev` takes `true` or thresholds (`{ "escalateAt": 0.85, "spamAt": 0.9, "noReplyAt": 0.9 }`). The key
is `TYPESAFE_API_KEY` in hush; the autopilot already runs with the tenant's Postproxy key, so the
scoring runs as its own `hush run` child (`scripts/jev.mjs`).

```
```

## Links on Instagram

Instagram never makes a URL in a caption or a comment clickable; only the bio link and DMs are. So a
story post is written for that: the caption and the first comment ask people to comment LINK, the
autopilot answers each of them with the link by DM (`private_reply`, allowed once per comment within
7 days) and acknowledges publicly, and the bio link points at the site. `linkReply: false` turns
the rule off for tenants that do not want it. The link a post carries is recorded at publish time
(`campaign.story.url` or `campaign.link`), so the rule knows which URL belongs to which post.
`ziggy dmlink <slug> <postId> <commentId> --text …` does the same by hand.

## The playbook

`tenants/<slug>/playbook.md` is the whole brief the agent sees: voice, always/never, what to
escalate, example replies. Write it like onboarding notes for a new community manager. The prompt
adds the rules every tenant shares: reply only when it adds something, under 220 characters, no
hashtags, at most one emoji, nothing the playbook does not promise, same language as the person.

## Scheduling

`ziggy watch <slug> --install` writes a launchd agent (macOS, `~/Library/LaunchAgents/
org.turinglabs.ziggy.<slug>.plist`) or a crontab line that runs `ziggy autopilot <slug> --quiet` every
`--interval` seconds, logging to `~/.ziggy/tenants/<slug>/inbox/autopilot.log`. The job needs no
Bitwarden session: `hush run` decrypts with the local age identity. Start in `draft` mode for a few
days, read `ziggy queue`, tune the playbook, then switch to `auto`.
