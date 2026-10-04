#!/bin/bash
# Sync 2 엔진 검사: 로컬 Worker를 띄우고 실제 API로 비교·적용·백업·영수증을 확인한다.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
COMMON=( -fobjc-arc -fobjc-arc-exceptions -fblocks -arch x86_64 -mmacosx-version-min=10.13 -Werror=unguarded-availability -framework Cocoa -framework Security -lsqlite3 )
clang "${COMMON[@]}" YBCore.m YBPlaylistIO.m YBPlaylistFormat.m YB2Server.m YB2Receipt.m YB2Engine.m YB2Test.m -o build/yb2-test
cd ..
node mac-sync2/test-server2.mjs mac-sync2/build/yb2-test
