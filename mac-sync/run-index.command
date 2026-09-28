#!/bin/bash
set -e
cd "$(dirname "$0")"
[ -x ./pp6-indexer ] || { chmod +x build.command; ./build.command; }
./pp6-indexer
printf '\n바탕화면에 pp6-index-v0.2.json 생성 완료.\n'
read -p "Enter를 누르면 닫힙니다."
