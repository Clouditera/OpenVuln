#!/bin/bash
# MOCK-ONLY local runner (archived path).
# Production/demo uses scripts/run-real-vh.sh + .env.vh (VULNHUNTER_MOCK=false).
echo "[run-demo] This script starts MOCK mode. Prefer: scripts/run-real-vh.sh" >&2
if [[ "${ALLOW_MOCK_DEMO:-}" != "1" ]]; then
  echo "[run-demo] Refusing without ALLOW_MOCK_DEMO=1 (demo is real-mode now)." >&2
  exit 2
fi
cd /home/lhy/dev/llm/OpenVuln
export DATABASE_URL=postgresql://openvuln:openvuln@localhost:5433/openvuln
export VULNHUNTER_MOCK=true
export ADMIN_TOKEN=dev-admin-token
export ADMIN_PUBLIC_KEY="$(cat .data/admin.pub.b64)"
export SCAN_COOLDOWN_DAYS=36500
export PORT=7860
export LOG_LEVEL=info
exec node packages/service/dist/main.js

