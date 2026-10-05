#!/bin/bash
# 설명서 그림: Sync 2 창을 로컬 Worker(지어낸 예시 자료)에 붙여 PNG로 저장한다. macOS 전용, 배포 앱과 따로 빌드한다.
# 사용: bash mac-sync2/capture.command [저장 폴더(mac-sync2 기준), 기본 build/manual-shots]
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-build/manual-shots}"
APP="build/capture/SyncCapture.app"
mkdir -p build/capture "$OUT" "$APP/Contents/MacOS"
COMMON=( -fobjc-arc -fobjc-arc-exceptions -fblocks -arch x86_64 -mmacosx-version-min=10.13 -Werror=unguarded-availability -framework Cocoa -framework Security -lsqlite3 )
clang "${COMMON[@]}" YBCore.m YBPlaylistIO.m YBPlaylistFormat.m PP6Core.m YB2Server.m YB2Receipt.m YB2Engine.m YB2Capture.m -o build/capture/yb2-capture-seed
clang "${COMMON[@]}" -DYB2_MANUAL_CAPTURE YBCore.m YBPlaylistIO.m YBPlaylistFormat.m PP6Core.m YBAppUI.m YBDocumentComparison.m YB2Server.m YB2Receipt.m YB2Engine.m YB2Update.m YB2App.m -o "$APP/Contents/MacOS/YebaeOnSync2"
cp Info.plist "$APP/Contents/Info.plist"
cd ..
node mac-sync2/capture-manual.mjs mac-sync2/build/capture "mac-sync2/$OUT"
