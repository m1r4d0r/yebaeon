#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
COMMON=( -fobjc-arc -fobjc-arc-exceptions -fblocks -arch x86_64 -mmacosx-version-min=10.13 -Werror=unguarded-availability -framework Cocoa -framework Security )
clang "${COMMON[@]}" YBSync.m YBServer.m pp6-sync.m -o pp6-sync
echo "완료: 예배온 Sync. run-sync.command를 열어 시작하세요."
