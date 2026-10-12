#!/bin/sh
# usage: sh ops/round/check.sh <out.png> <tenant> <campaign>...
# Prints duration, audio and loudness per reel, and writes a sheet: a frame at 3s (top row)
# and near the end (bottom row) for each, for the session to look at.
out=$1; shift; tmp=$(mktemp -d); i=0
while [ $# -gt 1 ]; do t=$1; c=$2; shift 2
  f=$(ls /data/tenants/$t/renders/$c/*reel-1080x1920.mp4 2>/dev/null | head -1)
  [ -z "$f" ] && { echo "$c: NO RENDER"; continue; }
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" </dev/null)
  a=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$f" </dev/null)
  v=$(ffmpeg -nostdin -i "$f" -af volumedetect -vn -f null - 2>&1 | grep -oE "mean_volume: [-0-9.]+" | cut -d" " -f2)
  j=$(node -e "console.log(require('/data/campaigns/$t/$c/campaign.json').audio.jingle)")
  echo "$c: ${d%.*}s audio=${a:-NONE} mean=${v}dB jingle=$j"
  ffmpeg -nostdin -v error -y -ss 3 -i "$f" -frames:v 1 -vf scale=160:284 "$tmp/a$i.png"
  ffmpeg -nostdin -v error -y -ss "$(awk "BEGIN{print $d-0.8}")" -i "$f" -frames:v 1 -vf scale=160:284 "$tmp/b$i.png"
  i=$((i+1))
done
[ $i -eq 0 ] && exit 1
ins=""; for k in $(seq 0 $((i-1))); do ins="$ins -i $tmp/a$k.png"; done; for k in $(seq 0 $((i-1))); do ins="$ins -i $tmp/b$k.png"; done
if [ $i -gt 1 ]; then ffmpeg -nostdin -v error -y $ins -filter_complex "$(for k in $(seq 0 $((i-1))); do printf "[%d]" $k; done)hstack=inputs=$i[a];$(for k in $(seq $i $((2*i-1))); do printf "[%d]" $k; done)hstack=inputs=$i[b];[a][b]vstack" "$out"
else ffmpeg -nostdin -v error -y $ins -filter_complex "[0][1]vstack" "$out"; fi
rm -rf "$tmp"
