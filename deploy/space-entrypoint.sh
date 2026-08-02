#!/bin/sh
# OpenVuln HF / all-in-one entrypoint:
#   1) embedded PostgreSQL on /data/postgresql
#   2) MinIO on /data/minio (optional for app today)
#   3) node API+SPA on :7860
#
# Must tolerate HF Docker Spaces: persistent /data often root-owned;
# container may start as root or as uid 1000. Prefer root for PG init,
# then drop to node for the app when possible.
set -eu

log() { echo "[openvuln-entrypoint] $*" >&2; }

: "${POSTGRES_USER:=openvuln}"
: "${POSTGRES_DB:=openvuln}"
: "${MINIO_ROOT_USER:?Missing required MINIO_ROOT_USER}"
: "${MINIO_ROOT_PASSWORD:?Missing required MINIO_ROOT_PASSWORD}"
: "${POSTGRES_PASSWORD:?Missing required POSTGRES_PASSWORD}"

PGDATA="${PGDATA:-/data/postgresql}"
MINIO_DATA="${MINIO_DATA:-/data/minio}"
if [ -d /usr/lib/postgresql/current/bin ]; then
  PG_BIN="${PG_BIN:-/usr/lib/postgresql/current/bin}"
elif [ -d /usr/lib/postgresql/15/bin ]; then
  PG_BIN="${PG_BIN:-/usr/lib/postgresql/15/bin}"
else
  PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | head -1)}"
fi
export PATH="${PG_BIN}:$PATH"

# Ensure binaries exist early with a clear error
for b in initdb pg_ctl psql postgres; do
  if ! command -v "$b" >/dev/null 2>&1; then
    log "FATAL: $b not found (PATH=$PATH)"
    ls -la /usr/lib/postgresql/ 2>&1 || true
    exit 1
  fi
done

UID_NOW="$(id -u)"
log "start uid=$UID_NOW PATH=$PATH PGDATA=$PGDATA"

mkdir -p /data "$PGDATA" "$MINIO_DATA" /var/run/postgresql /tmp 2>/dev/null || true

# If we are root, make /data tree owned by node (uid 1000) so PG can run
# either as root-owned cluster or as node. Prefer running postgres as the
# same user that owns PGDATA.
if [ "$UID_NOW" -eq 0 ]; then
  # node user exists in the official node image
  if id node >/dev/null 2>&1; then
    chown -R node:node /data /var/run/postgresql 2>/dev/null || true
  fi
fi

# PostgreSQL requires data directory mode 0700 or 0750 and ownership by the
# OS user that runs the postmaster.
chmod 0700 "$PGDATA" 2>/dev/null || true
chmod 0700 "$MINIO_DATA" 2>/dev/null || true

run_as_pg() {
  # Run a command as the OS user that should own the cluster.
  if [ "$UID_NOW" -eq 0 ] && id node >/dev/null 2>&1; then
    # Preserve env needed by child
    runuser -u node -- env \
      PATH="$PATH" \
      PGDATA="$PGDATA" \
      PGPASSWORD="${PGPASSWORD:-}" \
      HOME="/home/node" \
      "$@"
  else
    env PATH="$PATH" PGDATA="$PGDATA" PGPASSWORD="${PGPASSWORD:-}" "$@"
  fi
}

cleanup() {
  code=$?
  trap - EXIT INT TERM
  log "shutdown (code=$code)"
  if [ -n "${APP_PID:-}" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "${MINIO_PID:-}" ] && kill -0 "$MINIO_PID" 2>/dev/null; then
    kill -TERM "$MINIO_PID" 2>/dev/null || true
  fi
  if [ -f "$PGDATA/postmaster.pid" ]; then
    run_as_pg pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  fi
  wait 2>/dev/null || true
  exit "$code"
}
trap cleanup EXIT INT TERM

# Incomplete cluster from a crashed first boot → reset only that case
if [ -f "$PGDATA/PG_VERSION" ] && {
  [ ! -d "$PGDATA/pg_notify" ] || [ ! -d "$PGDATA/global" ] || [ ! -f "$PGDATA/postgresql.conf" ]
}; then
  log "Removing incomplete PostgreSQL data dir"
  rm -rf "$PGDATA"
  mkdir -p "$PGDATA"
  chmod 0700 "$PGDATA"
  if [ "$UID_NOW" -eq 0 ] && id node >/dev/null 2>&1; then
    chown -R node:node "$PGDATA"
  fi
fi

# Stale postmaster.pid after OOM/kill
if [ -f "$PGDATA/postmaster.pid" ]; then
  if ! run_as_pg pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    log "Removing stale postmaster.pid"
    rm -f "$PGDATA/postmaster.pid"
  fi
fi

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  log "Initializing PostgreSQL cluster in $PGDATA"
  # locales: C.UTF-8 is always available in debian slim
  if ! run_as_pg initdb -D "$PGDATA" \
      --username="$POSTGRES_USER" \
      --auth-host=trust \
      --auth-local=trust \
      --encoding=UTF8 \
      --locale=C.UTF-8 2>&1; then
    log "initdb failed; dir listing:"
    ls -la /data "$PGDATA" 2>&1 || true
    id
    exit 1
  fi
fi

# Ensure hba allows local password + trust socket (app uses TCP+password)
# Keep trust for local TCP so first ALTER USER works even if password unknown.
if [ -f "$PGDATA/pg_hba.conf" ]; then
  # idempotent: only append if missing
  if ! grep -q "openvuln-entrypoint-hba" "$PGDATA/pg_hba.conf" 2>/dev/null; then
    {
      echo "# openvuln-entrypoint-hba"
      echo "local   all             all                                     trust"
      echo "host    all             all             127.0.0.1/32            trust"
      echo "host    all             all             ::1/128                 trust"
    } >>"$PGDATA/pg_hba.conf"
    if [ "$UID_NOW" -eq 0 ] && id node >/dev/null 2>&1; then
      chown node:node "$PGDATA/pg_hba.conf" 2>/dev/null || true
    fi
  fi
fi

log "Starting PostgreSQL"
if ! run_as_pg pg_ctl -D "$PGDATA" -o "-h 127.0.0.1 -p 5432 -k /var/run/postgresql" -w start 2>&1; then
  log "pg_ctl start failed; trying /tmp socket dir"
  if ! run_as_pg pg_ctl -D "$PGDATA" -o "-h 127.0.0.1 -p 5432 -k /tmp" -w start 2>&1; then
    log "pg_ctl failed twice"
    ls -la "$PGDATA" 2>&1 || true
    tail -n 80 "$PGDATA/log/"*.log 2>/dev/null || tail -n 80 "$PGDATA/"*.log 2>/dev/null || true
    # dump current log if any
    if [ -f "$PGDATA/postmaster.pid" ]; then
      cat "$PGDATA/postmaster.pid" || true
    fi
    exit 1
  fi
fi

export PGPASSWORD="$POSTGRES_PASSWORD"

# Wait until accepting connections (belt + suspenders beyond pg_ctl -w)
i=0
until run_as_pg psql -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d postgres -c 'SELECT 1' >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    log "FATAL: PostgreSQL not accepting connections after 60s"
    exit 1
  fi
  sleep 1
done
log "PostgreSQL is ready"

run_as_pg psql -h 127.0.0.1 -p 5432 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "ALTER USER \"$POSTGRES_USER\" WITH PASSWORD '$POSTGRES_PASSWORD';" >/dev/null

if ! run_as_pg psql -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" | grep -q 1; then
  log "Creating database $POSTGRES_DB"
  run_as_pg psql -h 127.0.0.1 -p 5432 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE \"$POSTGRES_DB\";"
fi

# MinIO (best-effort; app may not require it yet)
export MINIO_ROOT_USER MINIO_ROOT_PASSWORD
if [ "$UID_NOW" -eq 0 ] && id node >/dev/null 2>&1; then
  runuser -u node -- minio server "$MINIO_DATA" --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 &
else
  minio server "$MINIO_DATA" --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 &
fi
MINIO_PID=$!

i=0
until curl --fail --silent http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    log "WARN: MinIO not ready after 30s — continuing (app may not need it)"
    break
  fi
  if ! kill -0 "$MINIO_PID" 2>/dev/null; then
    log "WARN: MinIO exited early — continuing"
    MINIO_PID=""
    break
  fi
  sleep 1
done

# Prefer embedded DB unless operator explicitly set DATABASE_URL to a remote host.
# If DATABASE_URL points at 127.0.0.1/localhost, always rewrite with current password
# so a stale Space secret cannot point the app at a dead/wrong local URL.
DEFAULT_DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="$DEFAULT_DB_URL"
elif echo "$DATABASE_URL" | grep -Eq '@(127\.0\.0\.1|localhost)(:|/)'; then
  log "Rewriting local DATABASE_URL to embedded cluster credentials"
  export DATABASE_URL="$DEFAULT_DB_URL"
else
  log "Using external DATABASE_URL host (embedded PG still started)"
fi

export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-$MINIO_ROOT_USER}"
export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-$MINIO_ROOT_PASSWORD}"
export S3_BUCKET="${S3_BUCKET:-openvuln-private}"
export S3_REGION="${S3_REGION:-us-east-1}"
export OBJECT_STORAGE_ENABLED="${OBJECT_STORAGE_ENABLED:-true}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-7860}"

log "Starting app (HOST=$HOST PORT=$PORT)"
cd /app

# Preserve full environment (HF Secrets) when dropping root → node.
if [ "$UID_NOW" -eq 0 ] && id node >/dev/null 2>&1; then
  # -m keeps env; only clear a few root-only vars if any
  runuser -u node -m -- node dist/main.js &
else
  node dist/main.js &
fi
APP_PID=$!

# Fail fast if app dies immediately
sleep 2
if ! kill -0 "$APP_PID" 2>/dev/null; then
  log "FATAL: app exited immediately"
  wait "$APP_PID" || true
  exit 1
fi

# Confirm DB from outside once more
if ! run_as_pg psql -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT 1' >/dev/null 2>&1; then
  log "FATAL: embedded PG lost after app start"
  exit 1
fi
log "ready — app pid=$APP_PID"

wait "$APP_PID"
