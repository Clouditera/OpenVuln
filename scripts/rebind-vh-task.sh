#!/usr/bin/env bash
# Rebind an OpenVuln scan_job to an already-completed VulnHunter task.
# Demo / fast-path verification only — not for production data.
#
# Usage:
#   DATABASE_URL=postgresql://... \
#   ./scripts/rebind-vh-task.sh --project lodash/lodash --vh-task <uuid> \
#     [--cancel-old] [--admin-token TOKEN] [--api http://127.0.0.1:7860]
#
# What it does:
#   1. Finds the latest scan_job for the project (or --job-id)
#   2. Optionally POSTs VH cancel on the previous vulnhunter_task_id (saves tokens)
#   3. UPDATE scan_jobs: vulnhunter_task_id=<target>, state=scanning, clear fail fields
#   4. Poller (≤30s) sees VH completed → sync findings + encrypt + events
#
# Caveat: project page commit_sha stays whatever was bound at submit — may not
# match the VH task's scanned tree. Fine for demo; don't use for formal datasets.
set -euo pipefail

PROJECT=""
JOB_ID=""
VH_TASK=""
CANCEL_OLD=0
API_BASE="${OPENVULN_API:-http://127.0.0.1:7860}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
DATABASE_URL="${DATABASE_URL:-}"
# Override when psql is only inside a container, e.g.:
#   --psql-cmd "docker exec -i ov-pg-tmp psql -U openvuln -d openvuln"
PSQL_CMD=""

usage() {
  cat <<'USAGE'
Rebind an OpenVuln scan_job to an already-completed VulnHunter task.
Demo / fast-path only — not for production data.

Usage:
  DATABASE_URL=postgresql://... \
  ./scripts/rebind-vh-task.sh --project lodash/lodash --vh-task <uuid> \
    [--cancel-old] [--admin-token TOKEN] [--api http://127.0.0.1:7860] \
    [--psql-cmd "docker exec -i ov-pg-tmp psql -U openvuln -d openvuln"]

Steps: resolve job → optional VH cancel of old task → UPDATE bind+scanning.
Poller (≤30s) syncs if VH task is completed.
USAGE
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --job-id) JOB_ID="${2:-}"; shift 2 ;;
    --vh-task) VH_TASK="${2:-}"; shift 2 ;;
    --cancel-old) CANCEL_OLD=1; shift ;;
    --api) API_BASE="${2:-}"; shift 2 ;;
    --admin-token) ADMIN_TOKEN="${2:-}"; shift 2 ;;
    --psql-cmd) PSQL_CMD="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

if [[ -z "$VH_TASK" ]]; then
  echo "ERROR: --vh-task <uuid> required" >&2
  exit 1
fi
if [[ -z "$PROJECT" && -z "$JOB_ID" ]]; then
  echo "ERROR: --project owner/repo or --job-id required" >&2
  exit 1
fi
if [[ -z "$PSQL_CMD" && -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL or --psql-cmd required" >&2
  exit 1
fi

if [[ -z "$PSQL_CMD" ]]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "ERROR: psql not found; pass --psql-cmd 'docker exec -i … psql …'" >&2
    exit 1
  fi
  PSQL_CMD=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)
else
  # shellcheck disable=SC2206
  PSQL_CMD=($PSQL_CMD)
fi

psql_q() {
  "${PSQL_CMD[@]}" -At -c "$1"
}

psql_f() {
  "${PSQL_CMD[@]}" -v ON_ERROR_STOP=1
}

echo "==> Resolve scan_job"
if [[ -n "$JOB_ID" ]]; then
  ROW=$(psql_q "
    SELECT j.id||'|'||j.project_id||'|'||COALESCE(j.vulnhunter_task_id::text,'')||'|'||j.state||'|'||p.full_name
    FROM scan_jobs j JOIN projects p ON p.id=j.project_id
    WHERE j.id='${JOB_ID}'::uuid
  ")
else
  ROW=$(psql_q "
    SELECT j.id||'|'||j.project_id||'|'||COALESCE(j.vulnhunter_task_id::text,'')||'|'||j.state||'|'||p.full_name
    FROM scan_jobs j JOIN projects p ON p.id=j.project_id
    WHERE p.full_name='${PROJECT}' AND p.removed_at IS NULL
    ORDER BY j.created_at DESC
    LIMIT 1
  ")
fi

if [[ -z "$ROW" ]]; then
  echo "ERROR: no scan_job found" >&2
  exit 1
fi

IFS='|' read -r JOB_ID PROJECT_ID OLD_VH STATE FULL_NAME <<<"$ROW"
echo "    project=$FULL_NAME"
echo "    job_id=$JOB_ID"
echo "    state=$STATE"
echo "    old_vh_task=${OLD_VH:-none}"
echo "    new_vh_task=$VH_TASK"

if [[ "$CANCEL_OLD" -eq 1 && -n "$OLD_VH" && "$OLD_VH" != "$VH_TASK" ]]; then
  echo "==> Cancel old VH task (best-effort)"
  if [[ -z "${VULNHUNTER_BASE_URL:-}" || -z "${VULNHUNTER_API_TOKEN:-}" ]]; then
    echo "    skip: set VULNHUNTER_BASE_URL + VULNHUNTER_API_TOKEN to cancel"
  else
    CODE=$(curl -s -o /tmp/ov-rebind-cancel.json -w '%{http_code}' \
      -X POST \
      -H "Authorization: Bearer ${VULNHUNTER_API_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{}' \
      "${VULNHUNTER_BASE_URL%/}/api/tasks/${OLD_VH}/cancel" || true)
    echo "    cancel HTTP $CODE $(head -c 120 /tmp/ov-rebind-cancel.json 2>/dev/null || true)"
  fi
fi

echo "==> Rebind + set scanning"
psql_f <<SQL
UPDATE scan_jobs
SET
  vulnhunter_task_id = '${VH_TASK}'::uuid,
  state = 'scanning',
  fail_reason_internal = NULL,
  finished_at = NULL,
  consecutive_failures = 0,
  started_at = COALESCE(started_at, now())
WHERE id = '${JOB_ID}'::uuid;

SELECT id, state, vulnhunter_task_id, findings_so_far
FROM scan_jobs WHERE id = '${JOB_ID}'::uuid;
SQL

echo "==> Done. Poller will sync within ~30s if VH task is completed."
echo ""
echo "Verify:"
echo "  curl -s ${API_BASE}/api/projects/${FULL_NAME}"
if [[ -n "$ADMIN_TOKEN" ]]; then
  echo "  curl -s -H 'Authorization: Bearer ${ADMIN_TOKEN}' ${API_BASE}/api/admin/queue"
  echo "  # force sync if already failed-bound before:"
  echo "  curl -s -X POST -H 'Authorization: Bearer ${ADMIN_TOKEN}' \\"
  echo "    ${API_BASE}/api/admin/scan-jobs/${JOB_ID}/resync"
fi
echo ""
echo "Then: admin report-package → admin-cli decrypt → disclose → public page."
echo "NOTE: demo/fast-path only. commit_sha may not match VH task tree."
