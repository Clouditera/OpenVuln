import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { adminRouter } from "./features/admin/index.js";
import { authRouter } from "./features/auth/index.js";
import { notificationsRouter } from "./features/notifications/index.js";
import { projectsRouter } from "./features/projects/index.js";
import { reportRouter } from "./features/report/index.js";
import { statsRouter } from "./features/stats/index.js";
import type { ServiceConfig } from "./infra/config.js";
import { logger } from "./infra/logger.js";
import { loadSession } from "./middleware/auth.js";
import { errorHandler } from "./middleware/index.js";

function resolvePublicRoot(): string | null {
  const candidates = [
    join(process.cwd(), "public"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "public"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public"),
    // monorepo root → packages/service/public
    join(process.cwd(), "packages", "service", "public"),
  ];
  for (const p of candidates) {
    if (existsSync(join(p, "index.html"))) return p;
  }
  return null;
}

export function createApp(config: ServiceConfig): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.set("config", config);
    await next();
  });

  // CORS whitelist (CORS_ALLOWED_ORIGINS). Empty → no reflected Origin (same-origin OK).
  // "*" alone → open origin, credentials off (local/dev only).
  const allowed = new Set(config.corsAllowedOrigins);
  const openCors = allowed.has("*") && allowed.size === 1;
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return origin || "";
        if (openCors) return "*";
        if (allowed.has(origin)) return origin;
        return "";
      },
      credentials: !openCors,
    }),
  );

  app.get("/health", (c) => c.json({ ok: true, service: "openvuln" }));

  // Session cookie → c.var.user (optional)
  app.use("/api/*", loadSession);

  app.route("/api/auth", authRouter);
  // Design contract: GET /api/me (same handler as /api/auth/me)
  app.get("/api/me", (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/api/auth/me";
    return app.fetch(new Request(url.toString(), c.req.raw));
  });

  app.route("/api/stats", statsRouter);
  app.route("/api/notifications", notificationsRouter);

  // Public disclosed report (no auth) — mount before /:owner/:repo
  app.route("/api/projects/:id/report", reportRouter);
  app.route("/api/projects", projectsRouter);

  app.route("/api/admin", adminRouter);

  app.onError(errorHandler);

  const publicRoot = resolvePublicRoot();
  if (publicRoot) {
    logger.info({ publicRoot }, "Serving SPA static files");
    // Assets + files that exist on disk
    app.use(
      "/*",
      serveStatic({
        root: publicRoot,
        rewriteRequestPath: (path) => path,
      }),
    );
    // SPA fallback for client routes (no file extension)
    // index.html 按 mtime 缓存：前端重新构建后无需重启服务（v1.5 白屏事故修复）
    const indexPath = join(publicRoot, "index.html");
    let indexHtmlCache: { mtimeMs: number; html: string } | null = null;
    app.get("*", (c) => {
      const path = c.req.path;
      if (path.startsWith("/api") || extname(path)) {
        return c.notFound();
      }
      const mtimeMs = statSync(indexPath).mtimeMs;
      if (!indexHtmlCache || indexHtmlCache.mtimeMs !== mtimeMs) {
        indexHtmlCache = { mtimeMs, html: readFileSync(indexPath, "utf-8") };
      }
      return c.html(indexHtmlCache.html);
    });
  } else {
    logger.warn("No SPA public/ directory found — API only");
  }

  return app;
}
