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
   empty → skip.
2. **Ask the agent** with the playbook + the item. The agent is a command that reads the prompt on
   stdin and prints a JSON decision `{"action": "reply|skip|hide|escalate", "text": "…", "reason": "…"}`;
   the default is `claude -p --output-format json` (Claude Code headless). Codex, a local model or a
   script work the same way — set `autopilot.agent.command`.
3. **Act by mode**: `auto` posts replies / hides and logs; `draft` writes the proposal to the queue;
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
  "agent": { "command": ["claude", "-p", "--output-format", "json"], "timeoutMs": 120000 }
}
```

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
