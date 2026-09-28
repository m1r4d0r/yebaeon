#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "Experimental PP6 thumbnail renderer build"
clang -fobjc-arc -fblocks -mmacosx-version-min=10.13 \
  -framework Cocoa -framework AVFoundation \
  PP6Core.m pp6-thumbnail.m -o pp6-thumbnail
echo "완료: $(pwd)/pp6-thumbnail"
echo "예: ./pp6-thumbnail --document ~/Documents/ProPresenter6/토요일.pro6 --slide 1"
