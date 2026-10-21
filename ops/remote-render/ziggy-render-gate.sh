#!/bin/bash
# ziggy-render-gate — the only program Ziggy's render key may run on the laptop.
#
# Installed as ~/ziggy-render/bin/ziggy-render-gate and bound to the key in ~/.ssh/authorized_keys:
#   from="<mac pro tailnet ip>",restrict,command="$HOME/ziggy-render/bin/ziggy-render-gate" ssh-ed25519 AAAA… ziggy-render
#
# $SSH_ORIGINAL_COMMAND may be exactly one of:
#   health                         prints "ok free_kb=<N> jobs=<N> hf=<0|1>", prunes old job dirs
#   run <job> <quality> <version>  gzip tar of a HyperFrames project on stdin → the MP4 on stdout
# Anything else is denied (exit 2). Written for macOS bash 3.2 and BSD tools. See README.md here.
set -u
PATH="${ZIGGY_GATE_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
export PATH
IFS=$' \t\n'
umask 077

ROOT="$HOME/ziggy-render"
JOBS="$ROOT/jobs"
RE_JOB='^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
RE_QUALITY='^(draft|standard|high)$'
RE_VERSION='^[0-9]+\.[0-9]+\.[0-9]+$'

jobdir=""
rpid=""
wpid=""

deny() {
  echo "denied" >&2
  exit 2
}

on_exit() {
  status=$?
  if [ -n "$wpid" ]; then kill -TERM -- "-$wpid" 2>/dev/null; fi
  if [ -n "$rpid" ]; then kill -TERM -- "-$rpid" 2>/dev/null; fi
  if [ -n "$jobdir" ]; then rm -rf "$jobdir"; fi
  exit "$status"
}

health() {
  mkdir -p "$JOBS" || exit 1
  find "$JOBS" -mindepth 1 -maxdepth 1 -mmin +120 -exec rm -rf {} + 2>/dev/null
  free_kb=$(df -Pk "$HOME" 2>/dev/null | awk 'NR == 2 { print $4 }')
  njobs=$(find "$JOBS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  hf=0
  if command -v npx >/dev/null 2>&1; then hf=1; fi
  echo "ok free_kb=${free_kb:-0} jobs=${njobs:-0} hf=$hf"
  exit 0
}

run() {
  [ "$#" -eq 3 ] || deny
  job=$1
  quality=$2
  version=$3
  [[ $job =~ $RE_JOB ]] || deny
  [[ $quality =~ $RE_QUALITY ]] || deny
  [[ $version =~ $RE_VERSION ]] || deny

  limit=${ZIGGY_GATE_TIMEOUT:-900}
  case "$limit" in
    '' | *[!0-9]*) limit=900 ;;
  esac

  # from here on stdout carries the MP4 and nothing else
  exec 3>&1 1>&2

  mkdir -p "$JOBS" || exit 1
  mkdir "$JOBS/$job" || { echo "job $job already exists" >&2; exit 1; }
  jobdir="$JOBS/$job"
  trap on_exit EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 141' PIPE
  trap 'exit 143' TERM

  mkdir "$jobdir/project" || exit 1
  # bsdtar without -P already refuses absolute paths and "..": the archive stays inside project/
  tar -xzf - -C "$jobdir/project" || { echo "bad archive" >&2; exit 1; }
  # nothing that could change what npx runs: no dotfiles (.npmrc), no node_modules, no symlinks
  find "$jobdir/project" -mindepth 1 \( -name '.*' -o -name node_modules -o -type l \) -prune -exec rm -rf {} + 2>/dev/null
  [ -f "$jobdir/project/index.html" ] || { echo "no index.html in the archive" >&2; exit 1; }

  # BSD has no timeout(1): the render and a sleep+kill watchdog each get their own process group
  set -m
  (cd "$jobdir/project" && exec npx --yes "hyperframes@$version" render . --skill=motion-graphics -q "$quality" -o ../out.mp4) </dev/null >&2 3>&- &
  rpid=$!
  (sleep "$limit"; echo "render timed out after ${limit}s" >&2; kill -TERM -- "-$rpid" 2>/dev/null; sleep 5; kill -KILL -- "-$rpid" 2>/dev/null) </dev/null >&2 3>&- &
  wpid=$!
  set +m

  wait "$rpid"
  rc=$?
  rpid=""
  kill -TERM -- "-$wpid" 2>/dev/null
  wpid=""

  if [ "$rc" -ne 0 ]; then echo "render failed (exit $rc)" >&2; exit 1; fi
  [ -s "$jobdir/out.mp4" ] || { echo "render produced no mp4" >&2; exit 1; }
  cat "$jobdir/out.mp4" >&3 || exit 1
  exit 0
}

set -f
set -- ${SSH_ORIGINAL_COMMAND:-}
set +f
verb=${1:-}
[ "$#" -gt 0 ] && shift

case "$verb" in
  health) [ "$#" -eq 0 ] || deny; health ;;
  run) run "$@" ;;
  *) deny ;;
esac
