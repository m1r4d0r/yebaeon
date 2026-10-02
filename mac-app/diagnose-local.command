#!/bin/bash
# Builds/tests the reader, then writes metadata only. Never launches Sync.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
if [[ "$(uname -s)" != Darwin ]]; then
  echo "교회 Mac에서 ProPresenter 6와 예배온 Sync를 종료한 뒤 실행하세요." >&2
  exit 1
fi
TEMP_AREA="$(mktemp -d -t yebaeon-diagnostic)"
trap 'rm -rf "$TEMP_AREA"' EXIT
COMMON=( -fobjc-arc -fobjc-arc-exceptions -fblocks -arch x86_64 -mmacosx-version-min=10.13 -Werror=unguarded-availability -framework Cocoa -framework Security )
SOURCES=( mac-sync/YBSync.m mac-app/YBPlaylistIO.m mac-app/YBPlaylistFormat.m )
clang "${COMMON[@]}" "${SOURCES[@]}" mac-app/diagnostic-test.m -o "$TEMP_AREA/diagnostic-test"
"$TEMP_AREA/diagnostic-test"
clang "${COMMON[@]}" "${SOURCES[@]}" mac-app/diagnose-local.m -o "$TEMP_AREA/diagnose-local"
if [[ "$#" == 1 && "$1" == --self-test ]]; then
  echo "Diagnostic binaries compiled; synthetic checks passed. No operating files read."
  exit 0
fi
OUTPUT="$(mktemp -d "$PWD/mac-app/diagnostic-XXXXXX")"
if "$TEMP_AREA/diagnose-local" "$@" > "$OUTPUT/local-diagnostic.partial"; then
  mv "$OUTPUT/local-diagnostic.partial" "$OUTPUT/local-diagnostic.json"
  echo "진단 완료: $OUTPUT/local-diagnostic.json"
  echo "재생목록 이름·문서 경로·해시·기준 기록이 포함됩니다. 내용을 확인한 뒤 이 JSON만 전달하세요."
else
  rm -f "$OUTPUT/local-diagnostic.partial"
  echo "진단을 완료하지 못했습니다. 원본/기준/서버는 변경하지 않았습니다. 위 오류를 전달해 주세요." >&2
  exit 1
fi
