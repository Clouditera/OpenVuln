import type { ServiceConfig } from "../../infra/config.js";
import { AppError } from "../../middleware/error-handler.js";
import type { AuthUser } from "../../middleware/auth.js";
import { fetchRepoPermission, GithubPermissionError } from "./github-oauth.js";
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

  let perm: Awaited<ReturnType<typeof fetchRepoPermission>>;
  try {
    perm = await fetchRepoPermission(user.githubToken, owner, repo, user.login);
  } catch (err) {
    if (err instanceof GithubPermissionError) {
      if (err.kind === "auth") {
        // Invalid/expired token or GitHub says forbidden → 403 (not 500)
        throw new AppError("ERR_FORBIDDEN", {
          reason: "repo_permission_denied",
          github_status: err.status,
          message:
            "Only GitHub repository admin or maintain role may access this action. Re-login if your session is stale.",
        });
      }
      throw new AppError("ERR_UPSTREAM", {
        reason: "github_permission_unreachable",
        github_status: err.status,
        message: "GitHub permission check failed. Retry shortly.",
      });
    }
    throw err;
  }

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
