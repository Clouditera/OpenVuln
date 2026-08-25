import type { ServiceConfig } from "../../infra/config.js";
import { AppError } from "../../middleware/error-handler.js";
import type { AuthUser } from "../../middleware/auth.js";
import { fetchRepoPermission, GithubPermissionError } from "./github-oauth.js";
import * as storage from "./storage.js";

const GRANT_TTL_HOURS = 24;

/**
 * Fork repos never count as "owned" (fish No.2128 / task-422a70bf):
 * no submit, no owner endpoints — even for the fork's own admin.
 * Public summary + admin console are unaffected.
 * In-memory TTL cache keeps the GitHub meta call off the hot path.
 */
const FORK_CHECK_TTL_MS = 10 * 60_000;
const forkFlagCache = new Map<number, { fork: boolean; at: number }>();

export function resetForkFlagCacheForTests(): void {
  forkFlagCache.clear();
}

async function isForkRepo(
  owner: string,
  repo: string,
  githubRepoId: number,
  cfg: ServiceConfig,
): Promise<boolean> {
  const hit = forkFlagCache.get(githubRepoId);
  if (hit && Date.now() - hit.at < FORK_CHECK_TTL_MS) return hit.fork;

  const { fetchRepoMeta } = await import("../projects/github.js");
  // Server token — works regardless of the user's token scope
  const meta = await fetchRepoMeta(owner, repo, cfg.github.serverToken);
  // Missing/unshaped meta only happens in unit-test mocks — treat as non-fork;
  // the role check below still gates access.
  const fork = (meta as { fork?: boolean } | undefined)?.fork === true;
  forkFlagCache.set(githubRepoId, { fork, at: Date.now() });
  return fork;
}

function forkDenied(upstream?: string | null): never {
  throw new AppError("ERR_FORBIDDEN", {
    reason: "fork_repo_not_allowed",
    upstream: upstream ?? null,
    message: upstream
      ? `Fork 仓库不可提交/操作，请提交上游主仓：${upstream}`
      : "Fork 仓库不可提交/操作，请提交上游主仓。",
  });
}

export async function requireRepoAccess(
  user: AuthUser,
  owner: string,
  repo: string,
  githubRepoId: number,
  cfg: ServiceConfig,
): Promise<"admin" | "maintain"> {
  // Fork gate first (task-422a70bf): even a fork owner/admin gets 403.
  if (await isForkRepo(owner, repo, githubRepoId, cfg)) {
    forkDenied();
  }

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
