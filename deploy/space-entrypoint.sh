#!/bin/sh
set -eu

: "${POSTGRES_USER:=openvuln}"
: "${POSTGRES_DB:=openvuln}"
: "${MINIO_ROOT_USER:?Missing required MINIO_ROOT_USER}"
: "${MINIO_ROOT_PASSWORD:?Missing required MINIO_ROOT_PASSWORD}"
: "${POSTGRES_PASSWORD:?Missing required POSTGRES_PASSWORD}"

PGDATA=/data/postgresql
MINIO_DATA=/data/minio
mkdir -p "$PGDATA" "$MINIO_DATA"
# Hugging Face mounts persistent /data at runtime with broad permissions.
# PostgreSQL refuses a cluster directory unless it is 0700 or 0750.
chmod 0700 "$PGDATA"
chmod 0700 "$MINIO_DATA"

cleanup() {
  code=$?
  trap - EXIT INT TERM
  if [ -n "${APP_PID:-}" ] && kill -0 "$APP_PID" 2>/dev/null; then kill -TERM "$APP_PID"; fi
  if [ -n "${MINIO_PID:-}" ] && kill -0 "$MINIO_PID" 2>/dev/null; then kill -TERM "$MINIO_PID"; fi
  if [ -f "$PGDATA/postmaster.pid" ]; then pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true; fi
  wait 2>/dev/null || true
  exit "$code"
}
trap cleanup EXIT INT TERM

# A failed first startup can leave PG_VERSION behind while initdb's system
# directories are incomplete. Only reset that unmistakably partial state; a
# complete cluster (including pg_notify and global metadata) is never reset.
if [ -f "$PGDATA/PG_VERSION" ] && { [ ! -d "$PGDATA/pg_notify" ] || [ ! -d "$PGDATA/global" ] || [ ! -f "$PGDATA/postgresql.conf" ]; }; then
  echo "Removing incomplete PostgreSQL initialization from a prior startup" >&2
  rm -rf "$PGDATA"
  mkdir -p "$PGDATA"
  chmod 0700 "$PGDATA"
fi

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Initializing PostgreSQL data directory"
  initdb -D "$PGDATA" --username="$POSTGRES_USER" --auth-host=trust --auth-local=trust
fi

export PGPASSWORD="$POSTGRES_PASSWORD"
pg_ctl -D "$PGDATA" -o "-h 127.0.0.1 -p 5432 -k /tmp" -w start
psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "ALTER USER \"$POSTGRES_USER\" PASSWORD '$POSTGRES_PASSWORD';"
psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -tc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" | grep -q 1 \
  || psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"$POSTGRES_DB\";"

export MINIO_ROOT_USER MINIO_ROOT_PASSWORD
minio server "$MINIO_DATA" --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 &
MINIO_PID=$!

until curl --fail --silent http://127.0.0.1:9000/minio/health/live >/dev/null; do
  if ! kill -0 "$MINIO_PID" 2>/dev/null; then
    echo "MinIO exited before becoming ready" >&2
    exit 1
  fi
  sleep 1
done

# The application creates the private bucket via the S3 API during startup.
export DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-$MINIO_ROOT_USER}"
export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-$MINIO_ROOT_PASSWORD}"
export S3_BUCKET="${S3_BUCKET:-openvuln-private}"
export S3_REGION="${S3_REGION:-us-east-1}"
export OBJECT_STORAGE_ENABLED="${OBJECT_STORAGE_ENABLED:-true}"

node dist/main.js &
APP_PID=$!
wait "$APP_PID"
