#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
COMMON=( -fobjc-arc -fobjc-arc-exceptions -fblocks -arch x86_64 -mmacosx-version-min=10.13 -Werror=unguarded-availability -framework Cocoa -framework Security )
SOURCES=( mac-sync/YBSync.m mac-sync/YBServer.m mac-sync/PP6Core.m mac-app/YBAppUI.m mac-app/YBPlaylistIO.m mac-app/PPSPlaylistController.m mac-app/YBLibrary.m mac-app/YBDocumentsController.m mac-app/YBMediaController.m )
clang "${COMMON[@]}" "${SOURCES[@]}" mac-app/app-test.m -o mac-app/app-test
./mac-app/app-test
clang "${COMMON[@]}" mac-sync/YBSync.m mac-sync/YBServer.m mac-app/YBLibrary.m mac-app/app-integration.m -o mac-app/app-integration
node mac-sync/test-server.mjs ./mac-app/app-integration
