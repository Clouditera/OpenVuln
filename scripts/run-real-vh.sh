#!/bin/bash
set -euo pipefail
cd /home/lhy/dev/llm/OpenVuln
export PATH="/home/lhy/.nvm/versions/node/v22.22.0/bin:$PATH"
set -a
source .env.vh
set +a
exec node packages/service/dist/main.js

