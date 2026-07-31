import { randomBytes } from "node:crypto";
import type { MeResponse } from "@openvuln/shared";
import type { ServiceConfig } from "../../infra/config.js";
import { AppError } from "../../middleware/error-handler.js";
import * as github from "./github.js";
import * as storage from "./storage.js";
import * as sessionStore from "./session.js";

/** In-memory OAuth state (prototype; single-instance OK). */
const pendingStates = new Map<string, { project: string | null; createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;

function pruneStates(): void {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (now - v.createdAt > STATE_TTL_MS) pendingStates.delete(k);
  }
}

export function beginOAuthLoginWithConfig(
  config: ServiceConfig,
  project: string | null,
): { state: string; url: string } {
  if (!config.github.clientId || !config.github.clientSecret) {
    throw new AppError("ERR_INTERNAL", { reason: "github_oauth_not_configured" });
  }
  pruneStates();
  const state = randomBytes(16).toString("base64url");
  pendingStates.set(state, { project, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: `${config.publicBaseUrl}/api/auth/github/callback`,
    scope: "read:user read:org public_repo",
    state,
  });
  return {
    state,
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
  };
}

export async function handleOAuthCallback(
  config: ServiceConfig,
  code: string,
  state: string,
): Promise<{ token: string; expiresAt: Date; redirectPath: string }> {
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending) {
    throw new AppError("ERR_VALIDATION", { reason: "invalid_oauth_state" });
  }

  const accessToken = await github.exchangeCodeForToken(
    code,
    config.github.clientId,
    config.github.clientSecret,
  );
  const ghUser = await github.fetchGitHubUser(accessToken);
  await storage.upsertIdentity(ghUser);

  let redirectPath = "/";
  if (pending.project) {
    const parts = pending.project.split("/");
    if (parts.length === 2) {
      const [owner, repo] = parts;
      redirectPath = `/projects/${owner}/${repo}`;
      try {
        // Resolve to root repo id for grant
        const { meta } = await github.resolveRootRepo(owner, repo, config.github.serverToken);
        const role = await github.checkRepoPermission(accessToken, meta.owner.login, meta.name, ghUser.login);
        if (role) {
          await storage.upsertGrant(ghUser.id, meta.id, role);
        }
      } catch (err) {
        // Grant failure should not block login; user lands on project page without grant
        if (err instanceof AppError && err.code === "ERR_FORBIDDEN") {
          // still login, redirect with query hint
          redirectPath = `/projects/${owner}/${repo}?auth_error=org_oauth_restricted`;
        }
      }
    }
  }

  // Discard GitHub access token — never persist
  const session = await sessionStore.createSession(ghUser.id);
  return { token: session.token, expiresAt: session.expiresAt, redirectPath };
}

export async function getMe(githubUserId: number, login: string, avatarUrl: string | null, isAdmin: boolean): Promise<MeResponse> {
  const grants = await storage.listGrantsForUser(githubUserId);
  return {
    authenticated: true,
    user: {
      github_user_id: githubUserId,
      login,
      avatar_url: avatarUrl,
      is_admin: isAdmin,
    },
    grants,
  };
}

export function anonymousMe(): MeResponse {
  return { authenticated: false, user: null, grants: [] };
}

/** Parse owner/repo from "owner/repo" or full github URL. */
export function parseProjectRef(ref: string | undefined | null): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  const m = trimmed.match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}
