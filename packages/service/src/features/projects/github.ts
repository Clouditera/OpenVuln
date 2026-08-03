import { AppError } from "../../middleware/error-handler.js";

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

export async function fetchRepoMeta(
  owner: string,
  repo: string,
  serverToken?: string,
): Promise<GitHubRepoMeta> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: authHeaders(serverToken || undefined),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError("ERR_UPSTREAM", {
      service: "github",
      step: "repo_meta",
      reason: "network",
      message: `GitHub unreachable: ${msg.slice(0, 200)}`,
    });
  }
  if (res.status === 404) {
    throw new AppError("ERR_NOT_FOUND", { resource: "github_repo", owner, repo });
  }
  if (res.status === 403) {
    // Could be rate limit or auth — treat as upstream-ish rate limit for server token path
    throw new AppError("ERR_RATE_LIMIT", { service: "github" });
  }
  if (res.status === 401) {
    throw new AppError("ERR_UPSTREAM", {
      service: "github",
      step: "repo_meta",
      status: 401,
      message: "GitHub rejected server credentials",
    });
  }
  if (!res.ok) {
    throw new AppError("ERR_UPSTREAM", {
      service: "github",
      step: "repo_meta",
      status: res.status,
    });
  }
  return (await res.json()) as GitHubRepoMeta;
}

/** Resolve root (non-fork) repo. */
export async function resolveRootRepo(
  owner: string,
  repo: string,
  serverToken?: string,
): Promise<{ meta: GitHubRepoMeta; wasFork: boolean }> {
  const meta = await fetchRepoMeta(owner, repo, serverToken);
  if (!meta.fork) return { meta, wasFork: false };

  const root = meta.source ?? meta.parent;
  if (!root) {
    throw new AppError("ERR_VALIDATION", {
      reason: "fork_without_source",
      message:
        "Fork repositories must resolve to an upstream root. Submit the upstream URL instead.",
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
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    const data = (await res.json()) as { sha?: string };
    return data.sha ?? null;
  }
  const text = (await res.text()).trim();
  return text || null;
}
