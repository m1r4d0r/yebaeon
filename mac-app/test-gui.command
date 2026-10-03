#!/bin/bash
# Offline, synthetic GUI checks only. No Node, Worker, production session or Actions.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo "이 검사는 로그인한 Mac 데스크톱에서 실행하세요." >&2
  exit 1
fi
COMMON=( -fobjc-arc -fobjc-arc-exceptions -fblocks -arch x86_64 -mmacosx-version-min=10.13 -Werror=unguarded-availability -framework Cocoa -framework Security )
SOURCES=( mac-sync/YBSync.m mac-sync/YBServer.m mac-sync/PP6Core.m mac-app/YBAppUI.m mac-app/YBPlaylistIO.m mac-app/YBPlaylistFormat.m mac-app/YBPlaylistSync.m mac-app/YBServerPlaylistsController.m mac-app/PPSPlaylistController.m mac-app/YBLibrary.m mac-app/YBDocumentsController.m mac-app/YBDocumentComparison.m mac-app/YBMediaController.m mac-app/YBMediaPlan.m )
TEMP_BINARY="$(mktemp -t yebaeon-gui)"
trap 'rm -f "$TEMP_BINARY"' EXIT
mkdir -p mac-app/test-output
clang "${COMMON[@]}" -DYB_TESTING=1 "${SOURCES[@]}" mac-app/app-test.m -o "$TEMP_BINARY" 2>&1 | tee mac-app/test-output/gui-build.log
"$TEMP_BINARY" 2>&1 | tee mac-app/test-output/gui-test.log
echo "격리 GUI 검사 완료. mac-app/test-output의 로그와 PNG를 확인하세요."
