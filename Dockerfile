# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS builder
WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY . .
ARG VITE_API_BASE_URL=https://openvuln.vulnhunter.pro
ARG VITE_LANDING=zai
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_LANDING=$VITE_LANDING
RUN pnpm install --frozen-lockfile \
  && rm -rf packages/shared/dist packages/shared/tsbuildinfo \
  && pnpm --filter @openvuln/shared exec tsc --build --force \
  && pnpm --filter @openvuln/web build
FROM nginx:1.27-alpine AS runtime
COPY docker/hf.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/packages/web/dist/ /usr/share/nginx/html/
EXPOSE 7860
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7860/health >/dev/null || exit 1
