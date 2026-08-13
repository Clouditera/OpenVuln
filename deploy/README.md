# OpenVuln deployment

**Production (VulnAgent):** multi-service compose — see [`compose.prod.yml`](./compose.prod.yml) and [`docs/deployment-public.md`](../docs/deployment-public.md).

```
Host nginx (TLS) → web:23100 → api (internal) → postgres (volume)
                              ↘ VulnHunter on host :28080
```

HF public UI is a **Static Space** (build artifacts only); API lives on Clouditera.

Operator **private key never** enters the server image — only `ADMIN_PUBLIC_KEY`.

## Production split stack

```bash
# build images (monorepo root)
docker build -f deploy/api/Dockerfile -t openvuln:api .
docker build -f deploy/web/Dockerfile -t openvuln:web .

# on server
cp deploy/.env.prod.example .env.prod   # fill secrets
docker compose -f deploy/compose.prod.yml --env-file .env.prod up -d
curl -sS http://127.0.0.1:23100/health
```

Env template: [`deploy/.env.prod.example`](./.env.prod.example).

## Local development

```bash
# Postgres only
docker compose -f deploy/docker-compose.yml up -d postgres

cp deploy/.env.example .env
# set VULNHUNTER_* + ADMIN_*

pnpm install
pnpm --filter @openvuln/shared build
pnpm --filter @openvuln/service build
pnpm --filter @openvuln/web build

set -a && source .env && set +a
pnpm --filter @openvuln/service start
```

Web package env: [`packages/web/.env.example`](../packages/web/.env.example) (`VITE_API_BASE_URL`, `VITE_LANDING`).

## Removed / deprecated

| Path | Status |
|---|---|
| Root `Dockerfile` | **Removed** — was all-in-one HF/local image |
| Root `.env.example` | **Removed** — use `deploy/.env.example` |
| `deploy/space-entrypoint.sh` | **Removed** — embedded PG/MinIO entrypoint |
| `deploy/Dockerfile` | **Removed** — superseded by `deploy/api` + `deploy/web` |

Prefer `compose.prod.yml` for any multi-container deploy.
