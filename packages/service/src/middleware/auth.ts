import { timingSafeEqual } from "node:crypto";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { ServiceConfig } from "../infra/config.js";
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS } from "../features/auth/routes.js";
import * as authStorage from "../features/auth/storage.js";
import { AppError } from "./error-handler.js";

export type AuthUser = {
  githubUserId: number;
  login: string;
  avatarUrl: string | null;
  githubToken: string;
};

declare module "hono" {
  interface ContextVariableMap {
    config: ServiceConfig;
    user?: AuthUser;
  }
}

/**
 * Admin routes: Authorization: Bearer <ADMIN_TOKEN>.
 * Empty ADMIN_TOKEN → all admin requests forbidden (fail closed).
 */
export const requireAdminToken = createMiddleware(async (c, next) => {
  const config = c.get("config");
  const expected = config.adminToken;
  if (!expected) {
    throw new AppError("ERR_FORBIDDEN", { reason: "admin_token_not_configured" });
  }
  const header = c.req.header("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const provided = m?.[1]?.trim() ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (!provided || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError("ERR_UNAUTHORIZED", { reason: "invalid_admin_token" });
  }
  await next();
});

/** Optional session: sets c.var.user when cookie valid. */
export const loadSession = createMiddleware(async (c, next) => {
  const raw = getCookie(c, SESSION_COOKIE_NAME);
  if (raw) {
    const sess = await authStorage.getSessionByRawId(raw);
    if (sess) {
      c.set("user", {
        githubUserId: sess.githubUserId,
        login: sess.login,
        avatarUrl: sess.avatarUrl,
        githubToken: sess.githubToken,
      });
      void authStorage.touchSession(raw, SESSION_TTL_DAYS);
    }
  }
  await next();
});

/** Require logged-in GitHub user. */
export const requireAuth = createMiddleware(async (c, next) => {
  const user = c.get("user");
  if (!user) {
    throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  }
  await next();
});
