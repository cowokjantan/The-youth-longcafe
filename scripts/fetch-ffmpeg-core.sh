#!/usr/bin/env bash
set -e
mkdir -p public
CORE_URL="https://unpkg.com/@ffmpeg/core@0.11.6/dist/ffmpeg-core.js"
OUT="public/ffmpeg-core.js"
echo "Downloading ffmpeg core from $CORE_URL -> $OUT"
curl -sSL "$CORE_URL" -o "$OUT"
echo "Downloaded. Size:"
ls -lh "$OUT"
