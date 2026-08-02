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
  && apt-get install -y --no-install-recommends postgresql postgresql-client curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl --fail --silent --show-error --location \
    https://dl.min.io/server/minio/release/linux-amd64/minio \
    --output /usr/local/bin/minio \
  && chmod 0755 /usr/local/bin/minio \
  && mkdir -p /data \
  && chmod 0777 /data

WORKDIR /app
ENV NODE_ENV=production \
    PORT=7860 \
    HOST=0.0.0.0 \
    PATH=/usr/lib/postgresql/15/bin:$PATH

COPY --from=builder /app ./
COPY --from=builder /workspace/deploy/space-entrypoint.sh /usr/local/bin/space-entrypoint
RUN chmod 0755 /usr/local/bin/space-entrypoint

EXPOSE 7860

# Docker Spaces runs containers as UID 1000; attached Storage is mounted at /data
# only at runtime and is therefore initialized by the entrypoint.
USER node
ENTRYPOINT ["space-entrypoint"]
