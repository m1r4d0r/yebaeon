#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x ./pp6-sync ]]; then bash ./build-sync.command; fi
./pp6-sync "$@"
