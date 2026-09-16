#!/bin/bash
# Builds SpeechBridge.app — a real app bundle, not a bare binary, because
# macOS's TCC privacy prompts (mic + speech recognition) require one: a
# loose executable's Info.plist doesn't reliably satisfy the check on
# current macOS. Run this after editing main.swift.
set -euo pipefail
cd "$(dirname "$0")"

swiftc main.swift -o speechbridge

APP="SpeechBridge.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
cp speechbridge "$APP/Contents/MacOS/speechbridge"

echo "Built $APP — run it with: open $APP"
echo "(or run $APP/Contents/MacOS/speechbridge directly from Terminal to see its logs)"
