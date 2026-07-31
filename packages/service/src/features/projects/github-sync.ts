export {
  resolveRootRepo,
  fetchDefaultBranchHeadSha,
  fetchRepoMeta,
  type GitHubRepoMeta,
} from "../auth/github.js";

/** Normalize various GitHub URL forms to {owner, repo}. */
export function parseGitHubUrl(input: string): { owner: string; repo: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  // Strip trailing slashes and .git
  let s = raw.replace(/\/+$/, "").replace(/\.git$/i, "");

  // ssh form git@github.com:owner/repo
  const ssh = s.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  // https://github.com/owner/repo[/...]
  const https = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)/i);
  if (https) return { owner: https[1], repo: https[2] };

  // bare owner/repo
  const bare = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (bare) return { owner: bare[1], repo: bare[2] };

  return null;
}
