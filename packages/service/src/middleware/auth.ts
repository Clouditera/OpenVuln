import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { RepoAccessRole } from "@openvuln/shared";
import { AppError } from "./error-handler.js";
import * as sessionStore from "../features/auth/session.js";
import { getDb } from "../infra/db/index.js";
import type { ServiceConfig } from "../infra/config.js";

export interface SessionUser {
  githubUserId: number;
  login: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser | null;
    config: ServiceConfig;
  }
}

const SESSION_COOKIE = "ov_session";

export { SESSION_COOKIE };

export const injectUser = createMiddleware(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    c.set("user", null);
    await next();
    return;
  }

  const session = await sessionStore.findValidSession(token);
  if (!session) {
    c.set("user", null);
    await next();
    return;
  }

  // Sliding expiry: extend if past halfway
  await sessionStore.maybeSlideExpiry(session.id, session.expiresAt);

  const config = c.get("config");
  const isAdmin = config.adminGithubLogins.includes(session.login.toLowerCase());

  c.set("user", {
    githubUserId: session.githubUserId,
    login: session.login,
    avatarUrl: session.avatarUrl,
    isAdmin,
  });
  await next();
});

export const requireAuth = createMiddleware(async (c, next) => {
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED");
  await next();
});

export const requireAdmin = createMiddleware(async (c, next) => {
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED");
  if (!user.isAdmin) throw new AppError("ERR_FORBIDDEN", { reason: "admin_only" });
  await next();
});

/** Require a grant on the project identified by :id (uuid) or by github_repo_id. */
export function requireGrant() {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");
    if (!user) throw new AppError("ERR_UNAUTHORIZED");

    const projectId = c.req.param("id");
    if (!projectId) throw new AppError("ERR_VALIDATION", { field: "id" });

    const db = getDb();
    const rows = await db<{ github_repo_id: string }[]>`
      SELECT github_repo_id::text FROM projects
      WHERE id = ${projectId}::uuid AND removed_at IS NULL
    `;
    if (rows.length === 0) throw new AppError("ERR_NOT_FOUND", { resource: "project" });

    const repoId = Number(rows[0].github_repo_id);

    // Admins bypass grant check
    if (user.isAdmin) {
      await next();
      return;
    }

    const grants = await db<{ role: RepoAccessRole }[]>`
      SELECT role FROM repo_access_grants
      WHERE github_user_id = ${user.githubUserId} AND github_repo_id = ${repoId}
    `;
    if (grants.length === 0) {
      throw new AppError("ERR_FORBIDDEN", { reason: "no_repo_grant" });
    }

    await next();
  });
}
