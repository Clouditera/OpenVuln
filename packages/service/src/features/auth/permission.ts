import type { ServiceConfig } from "../../infra/config.js";
import { AppError } from "../../middleware/error-handler.js";
import type { AuthUser } from "../../middleware/auth.js";
import { fetchRepoPermission } from "./github-oauth.js";
import * as storage from "./storage.js";

const GRANT_TTL_HOURS = 24;

export async function requireRepoAccess(
  user: AuthUser,
  owner: string,
  repo: string,
  githubRepoId: number,
  _cfg: ServiceConfig,
): Promise<"admin" | "maintain"> {
  const cached = await storage.getCachedGrant(user.githubUserId, githubRepoId, GRANT_TTL_HOURS);
  if (cached) return cached;

  const perm = await fetchRepoPermission(user.githubToken, owner, repo, user.login);
  if (perm !== "admin" && perm !== "maintain") {
    throw new AppError("ERR_FORBIDDEN", {
      reason: "repo_permission_denied",
      permission: perm,
      message: "Only GitHub repository admin or maintain role may access this action.",
    });
  }
  await storage.upsertGrant(user.githubUserId, githubRepoId, perm);
  return perm;
}
