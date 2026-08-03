# OpenVuln public deploy — HF Static frontend + VulnAgent backend

> Status: **backend live on VulnAgent** — TLS blocked on DNS NXDOMAIN for openvuln.clouditera.com  
> Live: container `openvuln-api` → `127.0.0.1:23100`, nginx Host openvuln.clouditera.com (HTTP), SPA `/var/www/openvuln`, empty DB + redis import 22  
> Host: `VulnAgent` = `47.94.46.24` (Aliyun ECS, Ubuntu 24.04, Docker 29)  
> Date: 2026-08-02

---

## 1. Target topology

```
Browser
  │  https
  ▼
HF Static Space  (SPA only — zai-org/OpenVuln or new static Space)
  │  fetch(https://api.<domain>/api/...)
  ▼
nginx :443 on VulnAgent   (existing — already terminates TLS for VH)
  │  proxy_pass http://127.0.0.1:17860
  ▼
openvuln-api container    (all-in-one image: Node + embedded PG + MinIO)
  │  http://172.17.0.1:28080  (or host network)
  ▼
vulnhunter-service        (already on this host :28080)
```

**Why not keep OV on HF Docker Space?** Limited ops control, `/data` permission pain, rebuild lag. HF Static is free/simple; backend stays on a machine we SSH.

---

## 2. Machine inventory (verified)

| Item | Value |
|---|---|
| SSH | `ssh VulnAgent` → `ecs-user` (docker group, passwordless sudo available via ops) |
| Spec | 4C / 7.1G RAM (~4.7G avail) / 60G free on `/` |
| Docker | 29.1.3 |
| VH | `vulnhunter-service:2.3.2` → `0.0.0.0:28080` |
| VH web | `:23000` (public), admin web `127.0.0.1:23001` |
| VH PG/MinIO | internal bridge `vulnhunter-internal` only |
| **80/443** | **host nginx** (active) — sites: `vulnhunt.clouditera.com`, `vulnhunter.pro`, `sandbox-plane.vulnhunter.pro` |
| Certs | Let’s Encrypt (`vulnhunt.clouditera.com`) + static PEM under `/etc/ssl/*.pro` |
| certbot | installed |
| Free high ports | most >23001 free (42099 used by something local) |

**Decision: reuse host nginx for HTTPS**, do **not** introduce a second Caddy on 80/443.

---

## 3. Port & path allocation

| Service | Bind | Notes |
|---|---|---|
| `openvuln-api` | `127.0.0.1:17860` → container `:7860` | **localhost only** — never publish 0.0.0.0 |
| embedded PG | container `127.0.0.1:5432` | not published |
| embedded MinIO | container `127.0.0.1:9000` | not published; app currently stores text in PG OVENC1 |
| nginx | host `80/443` | new `server_name` → proxy `127.0.0.1:17860` |
| VH | host `28080` | unchanged |

Suggested data root on host:

```
/home/ecs-user/openvuln/
  docker-compose.yml
  .env                  # secrets, mode 600, never git
  data/                 # bind → /data (PG + MinIO)
  nginx/openvuln.conf   # snippet to copy into sites-available
```

---

## 4. Container list

| Name | Image | Network | Volume |
|---|---|---|---|
| `openvuln-api` | `openvuln:allinone` (build from monorepo root `Dockerfile`) | `bridge` (default) **or** optional `openvuln-net` | `./data:/data` |

### Compose sketch (final file under `deploy/public/docker-compose.yml` when executing)

```yaml
services:
  openvuln:
    image: openvuln:allinone
    container_name: openvuln-api
    restart: unless-stopped
    ports:
      - "127.0.0.1:17860:7860"
    env_file: .env
    volumes:
      - ./data:/data
    # Reach host VH on :28080
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

**VH base URL inside container:** `http://host.docker.internal:28080`  
(workers do **not** need to pull from OV MinIO — archive path is **multipart upload** from OV → VH API; no S3 callback.)

---

## 5. HTTPS / nginx

### Domain (BLOCKED on fish)

Need a DNS A/AAAA → `47.94.46.24`, e.g.:

- `openvuln.clouditera.com` or
- `api.openvuln.<your-domain>`

### nginx site (pattern matches existing VH sites)

```nginx
server {
    listen 443 ssl;
    server_name openvuln.clouditera.com;   # ← fish domain

    # certbot --nginx  or copy LE paths after first issue
    ssl_certificate     /etc/letsencrypt/live/openvuln.clouditera.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/openvuln.clouditera.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 32m;   # API JSON only; zipballs stay server-side

    location / {
        proxy_pass http://127.0.0.1:17860;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}

server {
    listen 80;
    server_name openvuln.clouditera.com;
    return 301 https://$host$request_uri;
}
```

Issue cert after DNS propagates:

```bash
sudo certbot --nginx -d openvuln.clouditera.com
```

**No Caddy** unless fish prefers moving all TLS off nginx later.

---

## 6. Backend env (`.env` on host, mode 600)

| Var | Value |
|---|---|
| `POSTGRES_PASSWORD` | strong random |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | required by entrypoint |
| `ADMIN_TOKEN` | strong random |
| `ADMIN_PUBLIC_KEY` | base64 PEM (from `~/.openvuln/hf-prod/admin.pem` pair or new keygen) |
| `VULNHUNTER_BASE_URL` | `http://host.docker.internal:28080` |
| `VULNHUNTER_AUTH_MODE` | `token` |
| `VULNHUNTER_API_TOKEN` | production `vht_…` |
| `VULNHUNTER_CREDENTIAL_ID` | LLM credential id |
| `VULNHUNTER_MOCK` | `false` |
| `VH_SOURCE_MODE` | `archive` |
| `SCAN_CONCURRENCY` | `2`–`4` (share CPU with VH workers) |
| `PUBLIC_BASE_URL` | `https://openvuln.clouditera.com` |
| `CORS_ALLOWED_ORIGINS` | HF frontend origin(s), comma-separated |
| `HOST` | `0.0.0.0` |
| `PORT` | `7860` |
| `GITHUB_TOKEN` | optional, rate limit |

**Do not set** external `DATABASE_URL` unless using managed PG — leave unset so entrypoint builds embedded URL.

Reuse secrets from `~/.openvuln/hf-prod/hf-secrets.env` where applicable; **rotate** if those were ever pasted into HF Space UI logs.

---

## 7. CORS + frontend API base

### Backend

Already supports `CORS_ALLOWED_ORIGINS` (Hono cors). Set e.g.:

```
CORS_ALLOWED_ORIGINS=https://zai-org-openvuln.hf.space,https://huggingface.co
```

(Exact Static Space origin after create — check Space URL.)

### Frontend code change (required before Static deploy)

Today `packages/web/src/shared/api/client.ts` uses **relative** `/api/...` (same-origin). For split host:

```ts
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
// fetch(`${API_BASE}${path}`, { credentials: "include", ... })
```

Same for download `<a href>` in `ProjectPage` (report zip/md links).

Build:

```bash
VITE_API_BASE_URL=https://openvuln.clouditera.com pnpm --filter @openvuln/web build
```

Upload `packages/web/dist/**` to HF **Static** Space.

### HF Space strategy

| Option | Pros | Cons |
|---|---|---|
| **A. New Static Space** `zai-org/OpenVuln-Web` | Clean; leave broken Docker Space alone | Second Space to manage |
| **B. Convert `zai-org/OpenVuln` → Static** | One URL | Must change SDK in Space settings; wipe Docker history |

**Recommend A** for zero downtime / rollback: keep Docker Space parked until Static is healthy, then redirect README.

Static Space needs only:

- `index.html` + assets  
- README frontmatter `sdk: static`  
- No secrets

---

## 8. Zipball / MinIO / VH network (risk analysis)

| Path | Behavior | Risk on this host |
|---|---|---|
| `VH_SOURCE_MODE=archive` | OV downloads GitHub zip → **multipart POST** to VH `/api/tasks` | **Low** — no MinIO URL for workers |
| `VH_SOURCE_MODE=git_url` | VH clones from GitHub | Avoid (CN timeouts) |
| OV MinIO | Entrypoint starts it; app stores OVENC1 text in PG | **Low** — no worker pull required today |
| VH → OV callback | none | N/A |

**No shared docker network with `vulnhunter-internal` required** for MVP archive mode.  
If later we store large binaries in OV MinIO for VH workers, then either:

- publish MinIO on host loopback + nginx path, or  
- attach OV container to `vulnhunter-internal` and use service DNS — **out of scope for MVP**.

---

## 9. Resource budget

| Consumer | Notes |
|---|---|
| VH workers | already 2× scan containers |
| OV Node | light |
| OV embedded PG | small |
| Peak | zip download + multipart upload can spike RAM/CPU briefly |

Recommendation: `SCAN_CONCURRENCY=2` initially; watch `free -h` during first real scan.

Disk: `/home/ecs-user/openvuln/data` — PG growth with findings/artifacts OVENC1; 60G free is OK for MVP (monitor).

---

## 10. Data migration (local demo → public)

Local allinone (`openvuln-allinone` :7860) has demo projects (suricata/lodash disclose, redis import).

| Approach | How | When |
|---|---|---|
| **A. Fresh start** | Empty PG on server; re-import redis via admin-cli; re-disclose if needed | Cleanest for “prod” |
| **B. pg_dump** | `pg_dump` from local container → restore into server embedded PG | Keeps IDs/disclosures |
| **C. Offline import only** | `admin-cli import --run-dir` for showcase repos | No local DB coupling |

**Recommend A + C** for public: no accidental demo cruft; redis-8.8.0-glm52 re-import is proven.

Admin private key: use **same** keypair as disclose channel if you want continuity; else new keygen and only new discloses verify.

---

## 11. Operator workflow (after go-live)

```bash
# disclose (laptop)
pnpm --filter @openvuln/admin-cli exec node dist/cli.js fetch-package \
  --api https://openvuln.clouditera.com --token "$ADMIN_TOKEN" \
  --project <uuid> --out /tmp/pkg.json
pnpm --filter @openvuln/admin-cli exec node dist/cli.js decrypt /tmp/pkg.json \
  --key ~/.openvuln/hf-prod/admin.pem --out /tmp/plain.json
# … review … then signed disclose
```

Logs:

```bash
ssh VulnAgent 'docker logs -f openvuln-api'
```

Update image:

```bash
# build on laptop or on server
docker build -t openvuln:allinone .
docker save openvuln:allinone | ssh VulnAgent docker load
ssh VulnAgent 'cd ~/openvuln && docker compose up -d'
```

---

## 12. Execution checklist (when domain lands)

1. [ ] DNS A record → `47.94.46.24`
2. [ ] Frontend: add `VITE_API_BASE_URL` support in `client.ts` + download links
3. [ ] `deploy/public/docker-compose.yml` + `.env.example`
4. [ ] Build/push `openvuln:allinone` to VulnAgent
5. [ ] Start container; verify `curl -s http://127.0.0.1:17860/health`
6. [ ] nginx site + `certbot --nginx -d <domain>`
7. [ ] `curl -s https://<domain>/health`
8. [ ] CORS smoke from browser origin
9. [ ] Build SPA with `VITE_API_BASE_URL=https://<domain>`; deploy HF Static
10. [ ] Submit test repo → queue → VH task on :28080
11. [ ] admin-cli fetch-package / disclose smoke
12. [ ] Optional: re-import redis showcase
13. [ ] Decommission HF Docker Space secrets / mark Space as static-only

---

## 13. Risks & open questions

| Risk | Mitigation |
|---|---|
| Domain not ready | **Blocked** — cannot finish HTTPS/CORS/Static |
| nginx misconfig breaks VH sites | New `server_name` only; `nginx -t` before reload |
| CPU contention with VH scans | `SCAN_CONCURRENCY=2`; schedule |
| Disk 80% used | Monitor `data/`; prune old VH releases under `/home/ecs-user/vulnagent-release-*` is **ops decision**, not automatic |
| HF Static origin exact string | Confirm after Space create; update CORS |
| Session cookies cross-site | Public API is mostly cookie-less; `credentials: "include"` ok if no cookie auth for public. Admin stays Bearer from CLI |
| Mixed content | Must be HTTPS API — no IP-only http from HF |

### Open questions for fish

1. **Domain name?** (required)
2. Keep existing HF Docker Space URL or new Static Space name?
3. Fresh DB vs migrate local demo data?
4. Reuse `~/.openvuln/hf-prod` admin keypair or rotate?

---

## 14. Out of scope this phase

- Sharing VH’s Postgres/MinIO with OV  
- K8s / multi-node  
- CDN in front of API  
- Converting OV to external managed Postgres (possible later: set `DATABASE_URL` only)

---

## 15. Summary

| Layer | Where | How |
|---|---|---|
| UI | HF **Static** Space | `VITE_API_BASE_URL=https://api-domain` build |
| TLS | Host **nginx** :443 | New server_name + certbot |
| API | Docker `openvuln-api` | `127.0.0.1:17860`, root entrypoint + `/data` volume |
| Scan engine | Existing VH | `host.docker.internal:28080`, archive multipart |
| Secrets | Host `.env` 600 | Never in HF |

**Next action:** fish provides domain → developer implements frontend API base + compose + nginx + deploy.

---

## Collaboration model (2026-08-02)

| Repo | Role |
|---|---|
| **GitHub `Clouditera/OpenVuln`** | **Source of truth** — all feature work (backend + web) |
| **HF `spaces/zai-org/OpenVuln`** | **Deploy target only** — static build output (`pnpm --filter @openvuln/web build:hf`) |

Collaborator commits recovered on branch **`recover/hf-zai-landing`** (HF `8afb4cf` tip):
- `1911ccd` Z.ai landing + HF static mode (Yuxuan.Zhang2)
- Merged into main as `ZaiLandingPage` + `VITE_LANDING=zai` for HF builds; product site keeps full `HomePage`.

### Workflow
1. Collaborators push PRs to **GitHub**
2. CI / developer: `pnpm --filter @openvuln/web build:hf`
3. Publish `packages/web/dist/**` to HF Space `main` (static SDK)
4. Product UI on VulnAgent: `pnpm --filter @openvuln/web build` → `/var/www/openvuln`

---

## Frontend API base (build-time env)

No production API host is committed. Vite inlines env at **build** time:

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | empty | Same-origin `/api/...`. Set to full origin for cross-origin static hosts (e.g. HF). |
| `VITE_LANDING` | (unset → zai) | `zai` collaborator landing; `product` full product deck (`ProductHomePage`). |

Examples:

```bash
# Same-origin (openvuln.clouditera.com nginx SPA + /api)
pnpm --filter @openvuln/web build

# HF Static / other origin
VITE_API_BASE_URL=https://openvuln.clouditera.com pnpm --filter @openvuln/web build

# Product deck UI
VITE_LANDING=product pnpm --filter @openvuln/web build
```

See `packages/web/.env.example`. Do not commit `.env` / `.env.local` with secrets.

Product UI archive: branch `archive/product-ui`, tag `v0.1.0-product`.
