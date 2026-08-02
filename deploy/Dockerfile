# OpenVuln — single image: API + SPA static (HF Docker Space friendly)
# Build from monorepo root:
#   docker build -f deploy/Dockerfile -t openvuln:local .

# ---------- stage: deps + build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/service packages/service
COPY packages/web packages/web
COPY packages/admin-cli packages/admin-cli

# Full workspace install (devDeps needed for tsc/vite)
RUN pnpm install --frozen-lockfile

# Explicit order: shared types must exist before service tsc
RUN set -eux; \
  find packages -name '*.tsbuildinfo' -delete; \
  pnpm --filter @openvuln/shared run build; \
  test -f packages/shared/dist/index.d.ts; \
  pnpm --filter @openvuln/service run build; \
  pnpm --filter @openvuln/web run build; \
  rm -rf packages/service/public; \
  mkdir -p packages/service/public; \
  cp -r packages/web/dist/. packages/service/public/

# ---------- stage: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=7860 \
    LOG_LEVEL=info

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/service/package.json packages/service/

RUN pnpm install --frozen-lockfile --prod --filter @openvuln/service...

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/service/dist packages/service/dist
COPY --from=build /app/packages/service/package.json packages/service/package.json
COPY --from=build /app/packages/service/public packages/service/public

WORKDIR /app/packages/service

EXPOSE 7860

# Migrations run on boot (main.ts → runMigrations)
CMD ["node", "dist/main.js"]
