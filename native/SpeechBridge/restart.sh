#!/bin/bash
# Quit any running SpeechBridge and launch a fresh one (building it first if
# it's never been built). Never fails the caller: if SpeechBridge can't come
# up, the page just falls back to the browser recognizer.

cd "$(dirname "$0")" || exit 0

if [ "$(uname)" != "Darwin" ]; then
  echo "[speechbridge] not macOS — skipping"
  exit 0
fi

if pkill -x speechbridge; then
  for _ in $(seq 1 30); do
    pgrep -x speechbridge >/dev/null || break
    sleep 0.1
  done
  echo "[speechbridge] stopped the running instance"
fi

if [ ! -d SpeechBridge.app ]; then
  echo "[speechbridge] not built yet — building (macOS will ask for mic + speech permissions on first launch)"
  ./build.sh || { echo "[speechbridge] build failed — continuing without it"; exit 0; }
fi

# Launched via `open` so macOS attributes its permissions to the app bundle.
open SpeechBridge.app

for _ in $(seq 1 50); do
  if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[speechbridge] running on http://127.0.0.1:8765 (log: /tmp/speechbridge.log)"
    exit 0
  fi
  sleep 0.1
done

echo "[speechbridge] didn't start listening within 5s — check /tmp/speechbridge.log"
exit 0
