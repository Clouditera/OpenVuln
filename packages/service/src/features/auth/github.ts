import { logger } from "../../infra/logger.js";
import type { RepoAccessRole } from "@openvuln/shared";
import { AppError } from "../../middleware/error-handler.js";

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string | null;
}

export interface GitHubRepoMeta {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  default_branch: string;
  private: boolean;
  fork: boolean;
  parent?: { id: number; full_name: string; owner: { login: string }; html_url: string } | null;
  source?: { id: number; full_name: string; owner: { login: string }; html_url: string } | null;
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "OpenVuln/0.1",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });
  if (!res.ok) {
    throw new AppError("ERR_UPSTREAM", { service: "github", step: "oauth_token" });
  }
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    logger.warn({ error: data.error }, "GitHub OAuth token exchange failed");
    throw new AppError("ERR_UPSTREAM", { service: "github", step: "oauth_token", error: data.error });
  }
  return data.access_token;
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new AppError("ERR_UPSTREAM", { service: "github", step: "user" });
  }
  const data = (await res.json()) as GitHubUser;
  return {
    id: data.id,
    login: data.login,
    avatar_url: data.avatar_url ?? null,
  };
}

/**
 * Check collaborator permission. Returns role if admin/maintain, else null.
 */
export async function checkRepoPermission(
  accessToken: string,
  owner: string,
  repo: string,
  username: string,
): Promise<RepoAccessRole | null> {
  // Prefer the permission endpoint
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}/permission`,
    { headers: authHeaders(accessToken) },
  );

  if (res.status === 404) return null;
  if (res.status === 403) {
    // Org OAuth App restriction — surface as forbidden with reason
    throw new AppError("ERR_FORBIDDEN", {
      reason: "org_oauth_restricted",
      message:
        "Organization restricts third-party OAuth App access. Ask an org admin to approve OpenVuln.",
    });
  }
  if (!res.ok) {
    // Fallback: try repo endpoint permissions
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: authHeaders(accessToken),
    });
    if (!repoRes.ok) return null;
    const repoData = (await repoRes.json()) as {
      permissions?: { admin?: boolean; maintain?: boolean };
    };
    if (repoData.permissions?.admin) return "admin";
    if (repoData.permissions?.maintain) return "maintain";
    return null;
  }

  const data = (await res.json()) as { permission?: string };
  const perm = (data.permission ?? "").toLowerCase();
  if (perm === "admin") return "admin";
  if (perm === "maintain") return "maintain";
  return null;
}

export async function fetchRepoMeta(
  owner: string,
  repo: string,
  serverToken?: string,
): Promise<GitHubRepoMeta> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: authHeaders(serverToken || undefined),
  });
  if (res.status === 404) {
    throw new AppError("ERR_NOT_FOUND", { resource: "github_repo", owner, repo });
  }
  if (res.status === 403) {
    throw new AppError("ERR_RATE_LIMIT", { service: "github" });
  }
  if (!res.ok) {
    throw new AppError("ERR_UPSTREAM", { service: "github", step: "repo_meta", status: res.status });
  }
  return (await res.json()) as GitHubRepoMeta;
}

/** Resolve root (non-fork) repo. Returns the canonical repo meta. */
export async function resolveRootRepo(
  owner: string,
  repo: string,
  serverToken?: string,
): Promise<{ meta: GitHubRepoMeta; wasFork: boolean }> {
  const meta = await fetchRepoMeta(owner, repo, serverToken);
  if (!meta.fork) return { meta, wasFork: false };

  // Prefer source (ultimate root) over parent (immediate parent)
  const root = meta.source ?? meta.parent;
  if (!root) {
    // Fork without parent info — reject
    throw new AppError("ERR_VALIDATION", {
      reason: "fork_without_source",
      message: "Fork repositories must resolve to an upstream root. Submit the upstream URL instead.",
    });
  }
  const [rootOwner, rootName] = root.full_name.split("/");
  const rootMeta = await fetchRepoMeta(rootOwner, rootName, serverToken);
  return { meta: rootMeta, wasFork: true };
}

export async function fetchDefaultBranchHeadSha(
  owner: string,
  repo: string,
  branch: string,
  serverToken?: string,
): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`, {
    headers: {
      ...authHeaders(serverToken || undefined),
      accept: "application/vnd.github.sha",
    },
  });
  if (!res.ok) return null;
  // When Accept is sha, body is plain text sha; otherwise JSON
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    const data = (await res.json()) as { sha?: string };
    return data.sha ?? null;
  }
  const text = (await res.text()).trim();
  return text || null;
}
