#!/bin/bash
set -e
cd "$(dirname "$0")"
REPO_ROOT="$(cd .. && pwd)"
FIXTURES="$REPO_ROOT/test-pair"
if [ ! -f "$FIXTURES/local-documents/토요일.pro6" ] || [ ! -f "$FIXTURES/update/documents/토요일.pro6" ]; then
  printf '실제 교회 자료를 저장소 루트의 test-pair/에 먼저 준비하세요.\n'
  exit 1
fi
[ -x ./pp6-doc-compare ] || { chmod +x build.command; ./build.command; }
./pp6-doc-compare \
  --local-documents "$FIXTURES/local-documents" \
  --update "$FIXTURES/update" \
  --output "$FIXTURES/document-diff.json"
printf '\n테스트 결과: %s\n' "$FIXTURES/document-diff.json"
read -p "Enter를 누르면 닫힙니다."
