import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { AppError } from "./error-handler.js";
import type { ServiceConfig } from "../infra/config.js";

declare module "hono" {
  interface ContextVariableMap {
    config: ServiceConfig;
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
