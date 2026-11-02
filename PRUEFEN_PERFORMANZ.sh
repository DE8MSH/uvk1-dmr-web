#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Node.js 18+ wird benötigt'; exit 1; }
node tests/transport.cjs
node tests/queue.cjs
node tests/audio.cjs
node tests/pipeline.cjs
node tests/direct-audio.cjs
