#!/bin/bash
# 예배온 Sync 2 앱 빌드 (High Sierra 10.13 대상, Apple clang만 사용)
set -euo pipefail
cd "$(dirname "$0")"
APP="build/예배온 Sync 2.app"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/yebaeon-sync2-build.XXXXXX")"
trap 'rm -rf -- "$STAGING"' EXIT
mkdir -p "$STAGING/예배온 Sync 2.app/Contents/MacOS" "$STAGING/예배온 Sync 2.app/Contents/Resources"
COMMON=( -fobjc-arc -fobjc-arc-exceptions -fblocks -arch x86_64 -mmacosx-version-min=10.13 -Werror=unguarded-availability -framework Cocoa -framework Security -lsqlite3 )
clang "${COMMON[@]}" ../mac-sync/YBSync.m ../mac-sync/YBServer.m ../mac-app/YBPlaylistIO.m ../mac-app/YBPlaylistFormat.m ../mac-sync/PP6Core.m ../mac-app/YBAppUI.m ../mac-app/YBDocumentComparison.m YB2Server.m YB2Receipt.m YB2Engine.m YB2App.m -o "$STAGING/예배온 Sync 2.app/Contents/MacOS/YebaeOnSync2"
cp Info.plist "$STAGING/예배온 Sync 2.app/Contents/Info.plist"
if [[ -f ../mac-app/assets/SyncIcon-1024.png ]] && command -v iconutil >/dev/null 2>&1; then
  ICONSET="$STAGING/AppIcon.iconset"; mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -s format png -z "$size" "$size" ../mac-app/assets/SyncIcon-1024.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    doubled=$((size * 2)); sips -s format png -z "$doubled" "$doubled" ../mac-app/assets/SyncIcon-1024.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$STAGING/예배온 Sync 2.app/Contents/Resources/AppIcon.icns"
fi
if command -v codesign >/dev/null 2>&1; then codesign --force --sign - "$STAGING/예배온 Sync 2.app"; fi
mkdir -p build
if [[ -L "$APP" ]]; then echo "빌드 경로가 심볼릭 링크입니다."; exit 1; fi
if [[ -e "$APP" ]]; then mv "$APP" "$STAGING/previous.app"; fi
mv "$STAGING/예배온 Sync 2.app" "$APP"
echo "완료: $(pwd)/$APP"
