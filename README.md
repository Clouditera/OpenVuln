---
title: OpenVuln
emoji: 🛡️
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
---

# OpenVuln

Public vulnerability intelligence platform for open source.

Submit any public GitHub repository → OpenVuln queues a scan via the
[VulnHunter](https://github.com/Clouditera) AI engine → aggregate statistics are
public; detailed findings stay private to verified maintainers until they
disclose.

> Prototype status. Core loop (submit → queue → scan → stats → owner disclose →
> report download) works with a real VulnHunter backend.

**Repo:** https://github.com/Clouditera/OpenVuln

## Features (MVP prototype)

- Anonymous project submit (GitHub public repos only)
- DB-backed scan queue with configurable concurrency
- VulnHunter client (cookie / token)
- Public stats + severity / CWE views (no owner-only detail leakage)
- GitHub OAuth owner verification (admin/maintain)
- Owner-driven batch disclosure
- Report download: single finding, summary MD/JSON, or zip pack of disclosed findings
- Lightweight SPA (React + Vite + Tailwind)

## Quick start

```bash
pnpm install

# Postgres — keep the volume (never `compose down -v`)
docker compose -f deploy/docker-compose.yml up -d postgres

# One-time: isolated test database
docker exec deploy-postgres-1 psql -U openvuln -d postgres \
  -c "CREATE DATABASE openvuln_test OWNER openvuln;" 2>/dev/null || true

cp .env.example .env
# edit .env — set VULNHUNTER_* and ADMIN_* for your environment

pnpm --filter @openvuln/shared build
pnpm --filter @openvuln/service build
pnpm --filter @openvuln/web build
cp -a packages/web/dist packages/service/public

set -a && source .env && set +a
pnpm --filter @openvuln/service start

# seed 40 demo projects (idempotent)
pnpm seed:demo
```

- API + SPA: http://localhost:7860/
- Health: `curl http://localhost:7860/health`

### Demo data

```bash
pnpm seed:demo          # upsert demo projects
pnpm seed:demo:reset    # truncate demo DB then seed
```

### Tests

Tests always use `openvuln_test`, never the demo database.

```bash
pnpm --filter @openvuln/service test
```

## Configuration

See [`.env.example`](./.env.example). Important knobs:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `VULNHUNTER_BASE_URL` / auth | Real VulnHunter instance |
| `SCAN_CONCURRENCY` | In-flight scans (default 1) |
| `SCAN_COOLDOWN_DAYS` | Re-submit lock; demo uses `36500` (once per project) |
| `GITHUB_CLIENT_ID/SECRET` | OAuth App for owner verify |
| `VITE_GITHUB_REPO_URL` | Header GitHub icon target (build-time) |

## Monorepo

| Package | Role |
|---|---|
| `packages/shared` | API DTOs + error codes |
| `packages/service` | Hono API, scan queue, VH client, static SPA host |
| `packages/web` | React SPA |

## Security red line

Public routes only return aggregates and **disclosed** finding summaries.
Owner-only findings (title/path/code while private) are unreachable without a
verified repo grant. Report downloads follow the same rule.

## License

Apache License 2.0 — see [LICENSE](./LICENSE).
