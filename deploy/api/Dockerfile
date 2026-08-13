# syntax=docker/dockerfile:1
# OpenVuln API-only image (no embedded Postgres/MinIO).
# Build from monorepo root:
#   docker build -f deploy/api/Dockerfile -t openvuln:api .

FROM node:22-bookworm-slim AS builder

WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY . .
RUN pnpm install --frozen-lockfile \
  && rm -rf packages/shared/dist packages/shared/tsconfig.tsbuildinfo \
  && pnpm --filter @openvuln/shared exec tsc --build --force \
  && pnpm --filter @openvuln/service build \
  && pnpm --filter @openvuln/service --prod deploy /app

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=7860 \
    HOST=0.0.0.0

COPY --from=builder /app ./
RUN chown -R node:node /app

USER node
EXPOSE 7860

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "dist/main.js"]
