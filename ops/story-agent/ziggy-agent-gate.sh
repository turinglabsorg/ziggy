#!/bin/sh
# ziggy-agent-gate — the only program Ziggy's story-agent key may run on the Mac Pro.
#
# Installed as ~/ziggy-agent/bin/ziggy-agent-gate and bound to the key in ~/.ssh/authorized_keys:
#   from="127.0.0.1,::1",restrict,command="$HOME/ziggy-agent/bin/ziggy-agent-gate" ssh-ed25519 AAAA… ziggy-story-agent
#
# $SSH_ORIGINAL_COMMAND may be exactly one of:
#   claude-json (or empty)   the prompt on stdin → `claude -p --output-format json` → its JSON on stdout
#   health                   prints "ok" when claude is on the gate's PATH, else "no claude" (exit 1)
# Anything else is denied (exit 2). POSIX sh; macOS has no `timeout`, perl's alarm is the watchdog.
set -u
PATH="${ZIGGY_AGENT_GATE_PATH:-/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
export PATH
umask 077

case "${SSH_ORIGINAL_COMMAND-}" in
  health)
    if command -v claude >/dev/null 2>&1; then
      echo "ok"
      exit 0
    fi
    echo "no claude"
    exit 1
    ;;
  "" | claude-json)
    # an empty work dir: no project CLAUDE.md or settings are loaded
    work="$HOME/ziggy-agent/work"
    mkdir -p "$work" && cd "$work" || exit 1
    T="${ZIGGY_AGENT_GATE_TIMEOUT:-300}"
    case "$T" in "" | *[!0-9]*) T=300 ;; esac
    exec perl -e 'alarm shift; exec @ARGV or exit 127' "$T" claude -p --output-format json
    ;;
  *)
    echo "denied" >&2
    exit 2
    ;;
esac
