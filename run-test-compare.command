#!/bin/bash
set -e
cd "$(dirname "$0")"
[ -x ./pp6-doc-compare ] || { chmod +x build.command; ./build.command; }
./pp6-doc-compare \
  --local-documents "$(pwd)/test-pair/local-documents" \
  --update "$(pwd)/test-pair/update" \
  --output "$(pwd)/test-pair/document-diff.json"
printf '\n테스트 결과: %s\n' "$(pwd)/test-pair/document-diff.json"
read -p "Enter를 누르면 닫힙니다."
