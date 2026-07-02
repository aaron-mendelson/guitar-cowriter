#!/bin/bash
# Assemble GuitarCowriter.app from the SPM release build (no Xcode needed).
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
BIN=".build/release/GuitarCowriter"
APP="GuitarCowriter.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/GuitarCowriter"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Guitar Co-Writer</string>
  <key>CFBundleDisplayName</key><string>Guitar Co-Writer</string>
  <key>CFBundleIdentifier</key><string>com.aaronmendelson.guitarcowriter</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>GuitarCowriter</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>Guitar Co-Writer listens to your guitar through your audio interface so it can transcribe your playing and react to your take.</string>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP"
echo "Built $APP — open with: open mac/$APP (or double-click)"
