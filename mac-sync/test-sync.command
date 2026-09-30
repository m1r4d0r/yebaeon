#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
COMMON=( -fobjc-arc -fobjc-arc-exceptions -fblocks -arch x86_64 -mmacosx-version-min=10.13 -Werror=unguarded-availability -framework Cocoa -framework Security )
clang "${COMMON[@]}" YBSync.m YBServer.m sync-test.m -o sync-test
./sync-test
clang "${COMMON[@]}" YBSync.m YBServer.m sync-integration.m -o sync-integration
cd ..
node mac-sync/test-server.mjs
