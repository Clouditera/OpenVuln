# DEPRECATED for production split deploy — use deploy/compose.prod.yml + deploy/api|web Dockerfiles.
# Kept for legacy HF all-in-one / local experiments only.
# syntax=docker/dockerfile:1

# Build the workspace and assemble the SPA into the Hono service.
FROM node:22-bookworm-slim AS builder

WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY . .
RUN pnpm install --frozen-lockfile \
  && rm -rf packages/shared/dist packages/shared/tsconfig.tsbuildinfo \
  && pnpm --filter @openvuln/shared exec tsc --build --force \
  && pnpm --filter @openvuln/service build \
  && pnpm --filter @openvuln/web build \
  && mkdir -p packages/service/public \
  && cp -a packages/web/dist/. packages/service/public/ \
  && pnpm --filter @openvuln/service --prod deploy /app

# Docker Spaces expects the public web service on port 7860.
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       postgresql postgresql-client curl ca-certificates \
       util-linux locales \
  && rm -rf /var/lib/apt/lists/* \
  && curl --fail --silent --show-error --location \
    https://dl.min.io/server/minio/release/linux-amd64/minio \
    --output /usr/local/bin/minio \
  && chmod 0755 /usr/local/bin/minio \
  && mkdir -p /data /var/run/postgresql /home/node \
  && chmod 0777 /data \
  && chown -R node:node /home/node /var/run/postgresql \
  && PG_VER="$(ls /usr/lib/postgresql | head -1)" \
  && test -n "$PG_VER" \
  && ln -sfn "/usr/lib/postgresql/${PG_VER}/bin" /usr/lib/postgresql/current \
  && echo "PostgreSQL tools: ${PG_VER}"

WORKDIR /app
ENV NODE_ENV=production \
    PORT=7860 \
    HOST=0.0.0.0 \
    PATH=/usr/lib/postgresql/current/bin:/usr/lib/postgresql/15/bin:$PATH

COPY --from=builder /app ./
# App files readable by node after privilege drop
RUN chown -R node:node /app

COPY --from=builder /workspace/deploy/space-entrypoint.sh /usr/local/bin/space-entrypoint
# entrypoint stays root-owned so it can chown HF /data mounts at runtime
RUN chmod 0755 /usr/local/bin/space-entrypoint

EXPOSE 7860

# Stay root so entrypoint can fix /data ownership on HF persistent volumes,
# initdb/pg_ctl as node, then drop privileges for the Node process.
# (HF may also force uid 1000 — entrypoint handles both.)
USER root
ENTRYPOINT ["space-entrypoint"]
