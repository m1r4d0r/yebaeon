#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "YebaeOn Sync — PP6 Local Sync Core v0.2 build"
echo "--------------------------------"

COMMON=( -fobjc-arc -fblocks -mmacosx-version-min=10.13 -framework Cocoa )

clang "${COMMON[@]}" PP6Core.m pp6-indexer.m -o pp6-indexer
clang "${COMMON[@]}" PP6Core.m pp6-doc-compare.m -o pp6-doc-compare

echo
echo "완료"
echo "  $(pwd)/pp6-indexer"
echo "  $(pwd)/pp6-doc-compare"
