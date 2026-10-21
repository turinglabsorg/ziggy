# Story agent on the Mac Pro

The story summary and the semantic point judge (`skill/scripts/judge.mjs`) ask the story agent,
by default `claude -p --output-format json`. Claude Code is not installed in the container on
purpose, so in the container the agent runs on the Mac Pro host through a restricted SSH key:
the prompt goes on stdin, Claude's JSON comes back on stdout.

Where the command comes from (`storyAgent` in `skill/scripts/story.mjs`), first match wins:

1. `tenant.json → feed.agent` with a command of its own (`null`/`false` turns the agent off). A
   tenant that spells out the default `claude -p --output-format json` does not pin it.
2. `ZIGGY_STORY_AGENT_CMD` — a JSON array of strings; `ZIGGY_STORY_AGENT_TIMEOUT_MS` optional.
3. `/data/config.json → storyAgent` (read on every call, no restart needed).
4. The default `claude -p --output-format json`.

An invalid value at any step is ignored and the next one applies. When the agent fails, the round
logs `judge failed: <reason>` (e.g. `summary agent command not found: claude`,
`summary agent exited 255: …`) and keeps the lexical filter alone. `ziggy doctor <tenant>` shows
the agent's command and whether it can start.

## Security model

- A dedicated key, created in the container, used for nothing else. Never a personal key, never
  in git.
- On the host the key is bound to `ziggy-agent-gate` with `restrict` (no pty, no forwarding) and
  `from="127.0.0.1,::1"`: Docker Desktop on macOS delivers connections from the container to
  `host.docker.internal` from 127.0.0.1.
- The gate accepts only `claude-json` (or an empty command) and `health`; anything else answers
  `denied` (exit 2). `claude-json` runs exactly `claude -p --output-format json` in the empty
  directory `~/ziggy-agent/work` (no project CLAUDE.md is loaded), stdin passed through, under a
  watchdog of `ZIGGY_AGENT_GATE_TIMEOUT` seconds (default 300).
- The gate's `PATH` is fixed: `ZIGGY_AGENT_GATE_PATH`, else
  `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`.
- The container pins the host key (`StrictHostKeyChecking=yes`) in its own known_hosts file and
  uses `BatchMode` and `IdentitiesOnly`.

## Host setup (once)

`claude` must be installed and logged in for the user, and on the gate's `PATH`. If it lives
elsewhere, put `ZIGGY_AGENT_GATE_PATH=/its/bin:/usr/bin:/bin ` in front of the command in
`authorized_keys` (inside the quotes).

1. Turn on **System Settings → General → Sharing → Remote Login** for the user.
2. Install the gate:

   ```bash
   mkdir -p ~/ziggy-agent/bin ~/ziggy-agent/work
   cp ops/story-agent/ziggy-agent-gate.sh ~/ziggy-agent/bin/ziggy-agent-gate
   chmod 755 ~/ziggy-agent/bin/ziggy-agent-gate
   ```

3. Add the container's public key (see below) to `~/.ssh/authorized_keys`, one line:

   ```
   from="127.0.0.1,::1",restrict,command="$HOME/ziggy-agent/bin/ziggy-agent-gate" ssh-ed25519 AAAA… ziggy-story-agent
   ```

## Container setup (once)

The key and the pinned host key live in the `/data` volume, never in the image or in git.

```bash
docker compose exec ziggy sh -c 'mkdir -p /data/ssh && chmod 700 /data/ssh \
  && ssh-keygen -t ed25519 -N "" -C ziggy-story-agent -f /data/ssh/story-agent_ed25519'
docker compose exec ziggy cat /data/ssh/story-agent_ed25519.pub   # → host authorized_keys

# pin the host key (check the fingerprint against the host's
# `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` before trusting it)
docker compose exec ziggy sh -c 'ssh-keyscan -t ed25519 host.docker.internal > /data/ssh/story-agent_known_hosts \
  && ssh-keygen -lf /data/ssh/story-agent_known_hosts'

# try it: should print "ok"
docker compose exec ziggy ssh -i /data/ssh/story-agent_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/data/ssh/story-agent_known_hosts \
  zencrust@host.docker.internal health
```

## Turning it on and off

`/data/config.json`:

```json
{
  "storyAgent": {
    "command": ["ssh", "-i", "/data/ssh/story-agent_ed25519", "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=/data/ssh/story-agent_known_hosts", "-o", "ConnectTimeout=5",
      "-o", "ServerAliveInterval=30", "zencrust@host.docker.internal", "claude-json"],
    "timeoutMs": 180000
  }
}
```

- **Off**: remove the block, or `"enabled": false` in it (the default `claude` applies again,
  which the container does not have), or `ZIGGY_JUDGE=0` to turn the judge off.
- `ziggy round` warns once per round when the judge is on but the agent's command cannot start:
  `round: ⚠ judge on but its agent is unavailable (<reason>) — lexical filter only`.
