# Remote render on the MacBook

The Ziggy container renders HyperFrames reels on CPU: 4–11 minutes each. A MacBook Pro M1 Max on
the tailnet renders the same project in about 20 seconds. When remote render is on, every MP4
render (`render()` in `skill/scripts/video.mjs`: story reels, case files, the events reel) first
tries the laptop:

1. **health** — `ssh … health`; the answer is cached for 60 s, a failure for `downCacheSec`
   (shared by all render processes in `/data/state/remote-render-health.json`).
2. **slot** — at most `maxParallel` remote renders at once (`/data/state/remote-render-slots/`).
3. **pack** — an allowlist of render inputs (html, css, js, json, images, fonts, audio, video).
   Never dotfiles (`.env`), `renders/`, `snapshots/`, `node_modules/`, or anything named like a
   key, token, secret or credential.
4. **run** — the archive goes to the laptop on stdin, the MP4 comes back on stdout.
5. **verify** — size, `ffprobe` video stream, the project's `data-duration` (±1 s), an audio
   stream when the project has an audio asset.

Any problem — laptop asleep, off the tailnet, low on disk, render error, a bad MP4 — logs one
line and renders locally, as before. Rounds never stop because of the remote path; an offline
laptop costs at most a few seconds per round. Every attempt is one line in
`/data/state/remote-render.log.jsonl`.

`check` and `snapshot` always run in the container.

## Security model

- A dedicated key, created in the container, used for nothing else. Never a personal key, never
  in git.
- On the laptop the key is bound to `ziggy-render-gate` with `restrict` (no pty, no forwarding)
  and `from=` (only the Mac Pro's tailnet IP). The key can run `health` and
  `run <job> <quality> <version>`, with every argument checked against a strict pattern; anything
  else answers `denied`.
- The container pins the laptop's host key (`StrictHostKeyChecking=yes`) in its own known_hosts
  file and uses `BatchMode`, `IdentitiesOnly`, no agent or forwarding.
- The gate extracts into `~/ziggy-render/jobs/<job>/project` (no absolute paths, no `..`), drops
  dotfiles, `node_modules` and symlinks before rendering, and deletes the job directory when it
  exits. A watchdog kills a render after `ZIGGY_GATE_TIMEOUT` seconds (default 900).

## Laptop setup (once)

Node.js must be installed where the gate's `PATH` looks: `/opt/homebrew/bin` (Homebrew) or
`/usr/local/bin` (the nodejs.org installer). With nvm, put
`ZIGGY_GATE_PATH=/path/to/node/bin:/usr/bin:/bin:/usr/sbin:/sbin ` in front of the command in
`authorized_keys` (inside the quotes).

1. Turn on **System Settings → General → Sharing → Remote Login** for your user.
2. Install the gate:

   ```bash
   mkdir -p ~/ziggy-render/bin ~/ziggy-render/jobs
   cp ops/remote-render/ziggy-render-gate.sh ~/ziggy-render/bin/ziggy-render-gate
   chmod 755 ~/ziggy-render/bin/ziggy-render-gate
   ```

3. Warm the HyperFrames CLI and its headless browser once, so parallel renders do not race on a
   cold npx cache: render any HyperFrames project by hand with the pinned version, e.g.
   `npx --yes hyperframes@0.8.133 render . -o /tmp/warm.mp4` inside a project directory
   (version = `DEFAULT_HYPERFRAMES_VERSION` in `skill/scripts/video.mjs`).
4. Add the container's public key (see below) to `~/.ssh/authorized_keys`, one line:

   ```
   from="<mac pro tailnet ip>",restrict,command="$HOME/ziggy-render/bin/ziggy-render-gate" ssh-ed25519 AAAA… ziggy-render
   ```

5. Keep the laptop awake and on the tailnet while it should take renders (plugged in, and e.g.
   `caffeinate -s` or *Prevent automatic sleeping when the display is off*). If it sleeps or
   leaves the tailnet, renders silently fall back to local.

## Container setup (once)

The key and the pinned host key live in the `/data` volume, never in the image or in git.

```bash
# the key: created in the container, for this purpose only
docker compose exec ziggy sh -c 'mkdir -p /data/ssh && chmod 700 /data/ssh \
  && ssh-keygen -t ed25519 -N "" -C ziggy-render -f /data/ssh/remote-render_ed25519'
docker compose exec ziggy cat /data/ssh/remote-render_ed25519.pub   # → laptop authorized_keys

# pin the laptop's host key (check the fingerprint against the laptop's
# `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` before trusting it)
docker compose exec ziggy sh -c 'ssh-keyscan -t ed25519 <laptop tailnet ip> > /data/ssh/remote-render_known_hosts \
  && ssh-keygen -lf /data/ssh/remote-render_known_hosts'

# try it: should print "ok free_kb=… jobs=… hf=1"
docker compose exec ziggy ssh -i /data/ssh/remote-render_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/data/ssh/remote-render_known_hosts \
  <user>@<laptop tailnet ip> health
```

## Turning it on and off

`/data/config.json` (read on every render, no restart needed):

```json
{
  "remoteRender": {
    "enabled": true,
    "host": "<user>@<laptop tailnet ip>"
  }
}
```

Optional keys, with their defaults: `key` (`/data/ssh/remote-render_ed25519`), `knownHosts`
(`/data/ssh/remote-render_known_hosts`), `port` (22), `maxParallel` (2 — the laptop uses all its
cores per render), `connectTimeoutSec` (4), `renderTimeoutSec` (600), `minFreeGB` (10),
`slotWaitSec` (240 — how long a render waits for a free remote slot before rendering locally),
`downCacheSec` (120 — how long a failed health check keeps the laptop skipped).

- **Off now**: `"enabled": false` in config.json, or `ZIGGY_REMOTE_RENDER=0` in the environment
  (the kill switch: wins over everything).
- `ZIGGY_REMOTE_RENDER=1` forces it on (a host is still required); `ZIGGY_REMOTE_RENDER_HOST` and
  `ZIGGY_REMOTE_RENDER_KEY` override `host` and `key`.
- No key file → remote is off (one log line), renders stay local.
