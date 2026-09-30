#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
rebuild=0
[[ -x ./pp6-sync ]] || rebuild=1
for source in YBSync.h YBSync.m YBServer.m pp6-sync.m build-sync.command; do
  [[ "$source" -nt ./pp6-sync ]] && rebuild=1
done
if [[ "$rebuild" == 1 ]]; then bash ./build-sync.command; fi
./pp6-sync "$@"
