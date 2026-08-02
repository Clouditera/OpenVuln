#!/usr/bin/env bash
# Operator disclose demo against a running OpenVuln instance.
# Requires: local admin private key; ADMIN_TOKEN; project UUID.
set -euo pipefail
API="${OPENVULN_API:-http://127.0.0.1:7860}"
TOKEN="${ADMIN_TOKEN:-dev-admin-token}"
KEY="${ADMIN_KEY:-$HOME/dev/llm/OpenVuln/.data/admin.pem}"
PROJECT="${1:?usage: $0 <project-uuid> [finding-id,finding-id,...]}"
FINDINGS="${2:-}"
OUTDIR="${OUTDIR:-./openvuln-disclose-out}"
mkdir -p "$OUTDIR"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI=(pnpm --filter @openvuln/admin-cli exec node dist/cli.js)

echo "==> fetch-package"
"${CLI[@]}" fetch-package --api "$API" --token "$TOKEN" --project "$PROJECT" --out "$OUTDIR/pkg.json"

echo "==> decrypt"
"${CLI[@]}" decrypt "$OUTDIR/pkg.json" --key "$KEY" --out "$OUTDIR/report.md"
"${CLI[@]}" decrypt "$OUTDIR/pkg.json" --key "$KEY" --out "$OUTDIR/report.json" --format json

if [[ -z "$FINDINGS" ]]; then
  # default: first high + first medium from package
  FINDINGS=$(python3 - <<PY
import json
p=json.load(open("$OUTDIR/pkg.json"))
high=[i["finding_id"] for i in p["items"] if i["severity"]=="high"][:2]
med=[i["finding_id"] for i in p["items"] if i["severity"]=="medium"][:1]
print(",".join(high+med))
PY
)
  echo "    auto-picked findings: $FINDINGS"
fi

echo "==> disclose"
"${CLI[@]}" disclose \
  --api "$API" \
  --token "$TOKEN" \
  --key "$KEY" \
  --package "$OUTDIR/pkg.json" \
  --findings "$FINDINGS" \
  --summary "Operator demo disclosure"

echo "==> public check"
curl -s "$API/api/projects/$(python3 -c "import json;print(json.load(open('$OUTDIR/pkg.json'))['project']['full_name'])")" | python3 -c "import sys,json;d=json.load(sys.stdin);print('disclosed',len(d.get('disclosed_findings')or[]));print([x.get('title','')[:50] for x in d.get('disclosed_findings')or[]])"
echo "done → $OUTDIR"
