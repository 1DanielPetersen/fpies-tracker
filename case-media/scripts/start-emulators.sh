#!/usr/bin/env bash
# Starts the Firebase Local Emulator Suite (Auth + Firestore) for the project
# "demo-fpies". A demo- project id can never reach real Firebase.
# Needs Java 21+. Runs in the foreground; Ctrl+C stops it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$here/../.work"
mkdir -p "$work"
cd "$work" # firebase-tools writes its debug logs into the current folder

# Use a global firebase-tools if there is one, otherwise a pinned local copy
# (installed once into .work/tools). Run the binary itself, not through npx,
# so Ctrl+C and the run-all.sh cleanup reach it.
if command -v firebase >/dev/null 2>&1; then
  firebase="$(command -v firebase)"
else
  firebase="$work/tools/node_modules/.bin/firebase"
  [ -x "$firebase" ] || npm install --prefix "$work/tools" --no-audit --no-fund firebase-tools@15.36.0
fi
exec "$firebase" emulators:start --only auth,firestore --project demo-fpies --config "$here/firebase.json"
