#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
APP="build/예배온 Sync.app"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/yebaeon-build.XXXXXX")"
trap 'rm -rf -- "$STAGING"' EXIT
mkdir -p "$STAGING/예배온 Sync.app/Contents/MacOS" "$STAGING/예배온 Sync.app/Contents/Resources"
COMMON=( -fobjc-arc -fobjc-arc-exceptions -fblocks -arch x86_64 -mmacosx-version-min=10.13 -Werror=unguarded-availability -framework Cocoa -framework Security )
clang "${COMMON[@]}" ../mac-sync/YBSync.m ../mac-sync/YBServer.m ../mac-sync/PP6Core.m YBAppUI.m YBPlaylistIO.m YBPlaylistFormat.m YBPlaylistSync.m YBServerPlaylistsController.m PPSPlaylistController.m YBLibrary.m YBDocumentsController.m YBDocumentComparison.m YBMediaController.m YBMediaPlan.m main.m -o "$STAGING/예배온 Sync.app/Contents/MacOS/YebaeOnSync"
# Render the approved vector artwork into a legacy macOS icon family before signing.
ICONSET="$STAGING/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -s format png -z "$size" "$size" assets/SyncIcon-1024.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  doubled=$((size * 2))
  sips -s format png -z "$doubled" "$doubled" assets/SyncIcon-1024.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$STAGING/예배온 Sync.app/Contents/Resources/AppIcon.icns"
test -s "$STAGING/예배온 Sync.app/Contents/Resources/AppIcon.icns"
cp Info.plist "$STAGING/예배온 Sync.app/Contents/Info.plist"
for name in dummy_old dummy_new; do cp "fixtures/$name.xml" "$STAGING/예배온 Sync.app/Contents/Resources/$name.pro6pl"; done
if command -v codesign >/dev/null 2>&1; then codesign --force --sign - "$STAGING/예배온 Sync.app"; fi
mkdir -p build
# Only replace this script's generated app after compilation and signing succeeded.
if [[ -L "$APP" ]]; then echo "빌드 경로가 심볼릭 링크입니다."; exit 1; fi
if [[ -e "$APP" ]]; then mv "$APP" "$STAGING/previous.app"; fi
mv "$STAGING/예배온 Sync.app" "$APP"
echo "완료: $(pwd)/$APP"

