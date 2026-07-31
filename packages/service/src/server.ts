import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ServiceConfig } from "./infra/config.js";
import { injectUser, errorHandler } from "./middleware/index.js";
import { authRouter, meRouter } from "./features/auth/index.js";
import { projectsRouter } from "./features/projects/index.js";
import { findingsRouter } from "./features/findings/index.js";
import { disclosureRouter } from "./features/disclosure/index.js";
import { adminRouter } from "./features/admin/index.js";
import { statsRouter } from "./features/stats/index.js";
import { reportRouter } from "./features/report/index.js";
import { logger } from "./infra/logger.js";

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

  app.use(
    "*",
    cors({
      origin: (origin) => origin || "*",
      credentials: true,
    }),
  );
  app.use("*", injectUser);

  app.get("/health", (c) => c.json({ ok: true, service: "openvuln" }));

  app.route("/api/auth", authRouter);
  app.route("/api/me", meRouter);
  app.route("/api/stats", statsRouter);

  app.route("/api/projects/:id/findings", findingsRouter);
  app.route("/api/projects/:id/disclose", disclosureRouter);
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
