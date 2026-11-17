#!/usr/bin/env bash
# Regenerates everything in case-media/fpies-beskytter from the real app.
#
# Needs: Node 20+, Java 21+ (Firestore emulator), ffmpeg, Playwright with
# Chromium (for example: npm i -g playwright && npx playwright install chromium),
# and optionally oxipng for smaller PNGs.
#
# Safety: the app is built with a demo- Firebase project and only talks to the
# local emulators, and the capture browser blocks the real Firebase hosts.
#
# Optional: GEMINI_RECORD=1 VITE_GEMINI_API_KEY=... records one real Gemini
# answer per label (saved in scripts/data) and replays it from then on.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$repo/case-media/.work"
mkdir -p "$work"
cd "$repo"

# Background services get their own process group (job control), so stopping
# one stops everything it started, wrappers and children alike.
set -m
pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do [ -n "$pid" ] && kill -INT -- "-$pid" 2>/dev/null || true; done
  for _ in $(seq 1 15); do
    alive=0
    for pid in "${pids[@]:-}"; do [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && return 0
    sleep 1
  done
  for pid in "${pids[@]:-}"; do [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

is_up() { curl -sf -o /dev/null "$1"; }
wait_for() {
  for _ in $(seq 1 180); do is_up "$1" && return 0; sleep 1; done
  echo "Timed out waiting for $2 ($1)." >&2
  exit 1
}
need_free_port() {
  if is_up "http://127.0.0.1:$1/"; then
    echo "Port $1 is already in use ($2). Stop that process first." >&2
    exit 1
  fi
}

echo "1/6 Capture build (demo Firebase config, emulator mode, no Gemini key)"
[ -d node_modules ] || npm install --no-audit --no-fund
"$repo/node_modules/.bin/vite" build --config case-media/scripts/vite.capture.config.js --logLevel warn

echo "2/6 Firebase emulators (Auth + Firestore, project demo-fpies)"
need_free_port 8080 "Firestore emulator port"
need_free_port 9099 "Auth emulator port"
"$here/start-emulators.sh" > "$work/emulators.log" 2>&1 &
pids+=($!)
wait_for http://127.0.0.1:9099/ "the Auth emulator"
wait_for http://127.0.0.1:8080/ "the Firestore emulator"

echo "3/6 Preview server for the capture build"
need_free_port 4173 "preview server port"
"$repo/node_modules/.bin/vite" preview --config case-media/scripts/vite.capture.config.js > "$work/preview.log" 2>&1 &
pids+=($!)
wait_for http://127.0.0.1:4173/version.json "the preview server"

echo "4/6 Phone stills"
# The label photos are fixed inputs; they are only re-rendered if missing.
[ -f case-media/scripts/labels/puffs.jpg ] && [ -f case-media/scripts/labels/frugtmos.jpg ] || node case-media/scripts/make-labels.mjs
node case-media/scripts/capture-stills.mjs

echo "5/6 Film"
node case-media/scripts/capture-film-steps.mjs
node case-media/scripts/render-film.mjs

echo "6/6 Optimise PNGs and check every file"
if command -v oxipng >/dev/null 2>&1; then
  oxipng -o 4 --strip safe -q case-media/fpies-beskytter/*.png
else
  echo "   oxipng not found: PNGs left as captured."
fi
node case-media/scripts/verify-media.mjs
