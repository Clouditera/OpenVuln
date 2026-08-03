# OpenVuln deployment

Target topology (HF):

```
Browser → HF Static Space (optional pure-static) OR same-origin SPA from Docker Space
       → HF Docker Space :7860  (API + queue + poller + SPA public/)
       → Serverless Postgres (Neon / Supabase)
       → VulnHunter (token auth)
```

Operator **private key never** enters HF / the container. Only `ADMIN_PUBLIC_KEY` is injected.

## Local image smoke

```bash
# from monorepo root
docker build -f deploy/Dockerfile -t openvuln:local .

# need a reachable Postgres (compose on :5433 or ov-pg-tmp :5434)
docker run --rm -p 7860:7860 \
  -e DATABASE_URL=postgresql://openvuln:openvuln@host.docker.internal:5434/openvuln \
  -e ADMIN_TOKEN=dev-admin-token \
  -e ADMIN_PUBLIC_KEY="$(cat .data/admin.pub.b64)" \
  -e CORS_ALLOWED_ORIGINS=http://localhost:5173 \
  -e SCAN_CONCURRENCY=4 \
  openvuln:local

curl -s http://127.0.0.1:7860/health
```

Compose (Postgres only by default) lives in `deploy/docker-compose.yml`. Uncomment the `service` block once the image builds cleanly.

## Hugging Face Docker Space

### Embedded Postgres boot (all-in-one image)

Root `Dockerfile` starts as **root** so `deploy/space-entrypoint.sh` can:

1. `chown` the HF persistent `/data` mount to `node`
2. `initdb` + `pg_ctl` as `node` under `/data/postgresql`
3. wait until TCP `127.0.0.1:5432` accepts connections
4. drop privileges and run `node dist/main.js` as `node` (full env/secrets preserved)

If the Space process is forced to uid 1000 **and** `/data` is root-owned `0755`, initdb will fail with `Permission denied` — the root entrypoint avoids that. After a failed first boot, Factory reboot once the new image is live; incomplete clusters are auto-reset when `PG_VERSION` exists without `global/` / `pg_notify/`.

Required secrets for embedded mode: `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (plus app secrets). Do **not** set `DATABASE_URL` to a dead local URL — leave it unset so entrypoint builds `postgresql://openvuln:…@127.0.0.1:5432/openvuln`.

1. Create a **Docker** Space, SDK = Docker, hardware CPU basic is enough for the queue (concurrency 4).
2. Point the Space at this repo; Dockerfile path: `deploy/Dockerfile` (or copy to `/Dockerfile` if HF requires root).
3. Space **Secrets / Variables** (never commit):

| Name | Secret? | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon/Supabase connection string (`sslmode=require`) |
| `VULNHUNTER_BASE_URL` | no | e.g. `https://vulnhunt.example.com` |
| `VULNHUNTER_AUTH_MODE` | no | `token` |
| `VULNHUNTER_API_TOKEN` | yes | `vht_…` service account token |
| `VULNHUNTER_CREDENTIAL_ID` | yes* | if account has no default LLM credential |
| `ADMIN_TOKEN` | yes | Bearer for `/api/admin/*` |
| `ADMIN_PUBLIC_KEY` | yes | base64 PEM public key (`admin-cli keygen`) |
| `CORS_ALLOWED_ORIGINS` | no | Static Space origin(s), comma-separated |
| `PUBLIC_BASE_URL` | no | public API URL (HF Space URL) |
| `SCAN_CONCURRENCY` | no | default `4` |
| `SCAN_COOLDOWN_DAYS` | no | `36500` = one scan / project |
| `VH_SCAN_TIMEOUT_HOURS` | no | default `24` |
| `VH_MAX_ITEMS_PER_RECON` | no | default `10` |
| `VH_AGENT_MAX_PARALLEL` | no | default `5` |
| `VH_AUDIT_FOCUS` | no | default Chinese full-coverage string |
| `VH_ENABLE_DYNAMIC_VERIFY` | no | default `true` |
| `VH_ENABLE_DYNAMIC_EXPLOIT` | no | default `true` |
| `SCAN_VH_FAIL_GRACE_POLLS` | no | default `3` |
| `PORT` | no | HF usually `7860` |

4. After first boot check `/health` and that migrations applied (logs: `Migration applied` / `DB schema up to date`).
5. Admin ops stay **offline**: `packages/admin-cli` with the **private** key — `fetch` report-package → decrypt → disclose (signed).

### Optional Static Space frontend

If you split UI:

1. `pnpm --filter @openvuln/web build`
2. Upload `packages/web/dist` to a HF **Static** Space
3. Build with `VITE_API_BASE_URL=https://<docker-space>.hf.space` (or runtime config if you add one)
4. Set Docker `CORS_ALLOWED_ORIGINS` to the Static Space origin

Same-origin (SPA served from Docker `public/`) needs **empty** CORS list or the Docker Space origin only.

## Private key hygiene

- Generate once: `pnpm --filter @openvuln/admin-cli exec node dist/cli.js keygen --out admin.pem`
- Store `admin.pem` offline (multi-copy). Loss = all `OVENC1` ciphertext unreadable forever.
- Only the **public** half goes to `ADMIN_PUBLIC_KEY` in the cloud.

## Token rotation

VH `api_token` may expire (`expires_in_days`). Rotate before expiry: issue new token → update HF secret → restart Space. Prefer calendar reminder at T-7d.

## Local demo (current)

- Real mode: `scripts/run-real-vh.sh` + gitignored `.env.vh`
- Postgres: Docker `ov-pg-tmp` or compose `deploy/docker-compose.yml`
- Do **not** run `pnpm seed:demo` against the real demo DB (gated)

## Appendix: fast-path rebind (demo / integration only)

When a VulnHunter task is **already completed** (e.g. lodash 49 findings) and you
want to exercise OpenVuln sync → encrypt → report-package → disclose without
waiting hours for a new scan:

```bash
export DATABASE_URL='postgresql://openvuln:…@…/openvuln'
# optional: cancel the auto-dispatched VH task so it stops burning tokens
export VULNHUNTER_BASE_URL='https://…'
export VULNHUNTER_API_TOKEN='vht_…'

./scripts/rebind-vh-task.sh \
  --project lodash/lodash \
  --vh-task <completed-vh-task-uuid> \
  --cancel-old \
  --admin-token "$ADMIN_TOKEN" \
  --api http://127.0.0.1:7860
```

What it does: UPDATE latest `scan_jobs` row → `vulnhunter_task_id` + `state=scanning`,
optional VH cancel of the previous task id. Within one poller tick (~30s) the
service pulls findings, encrypts, flips `current_scan_job_id`.

If the job was already `failed`, you can also force:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API/api/admin/scan-jobs/<job-id>/resync"
```

**Caveats**

- Demo only. `commit_sha` on the project page is still the submit-time SHA and may
  not match the rebound VH task’s tree.
- Do not use for formal / public datasets.
- Requires `psql` + network access to the same DB the service uses.
