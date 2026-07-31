import type { RepoAccessRole } from "@openvuln/shared";
import { getDb } from "../../infra/db/index.js";
import type { GitHubUser } from "./github.js";

export async function upsertIdentity(user: GitHubUser): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO github_identities (user_id, login, avatar_url, first_seen_at, last_seen_at)
    VALUES (${user.id}, ${user.login}, ${user.avatar_url}, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      login = EXCLUDED.login,
      avatar_url = EXCLUDED.avatar_url,
      last_seen_at = now()
  `;
}

export async function upsertGrant(
  githubUserId: number,
  githubRepoId: number,
  role: RepoAccessRole,
): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO repo_access_grants (github_user_id, github_repo_id, role, verified_at)
    VALUES (${githubUserId}, ${githubRepoId}, ${role}, now())
    ON CONFLICT (github_user_id, github_repo_id) DO UPDATE SET
      role = EXCLUDED.role,
      verified_at = now()
  `;
}

export async function listGrantsForUser(githubUserId: number): Promise<
  Array<{
    github_repo_id: number;
    project_id: string | null;
    full_name: string | null;
    role: RepoAccessRole;
    verified_at: string;
  }>
> {
  const db = getDb();
  const rows = await db<{
    github_repo_id: string;
    project_id: string | null;
    full_name: string | null;
    role: RepoAccessRole;
    verified_at: Date;
  }[]>`
    SELECT
      g.github_repo_id::text,
      p.id::text AS project_id,
      p.full_name,
      g.role,
      g.verified_at
    FROM repo_access_grants g
    LEFT JOIN projects p ON p.github_repo_id = g.github_repo_id AND p.removed_at IS NULL
    WHERE g.github_user_id = ${githubUserId}
    ORDER BY g.verified_at DESC
  `;
  return rows.map((r) => ({
    github_repo_id: Number(r.github_repo_id),
    project_id: r.project_id,
    full_name: r.full_name,
    role: r.role,
    verified_at: r.verified_at.toISOString(),
  }));
}

export async function hasGrant(githubUserId: number, githubRepoId: number): Promise<boolean> {
  const db = getDb();
  const rows = await db`
    SELECT 1 FROM repo_access_grants
    WHERE github_user_id = ${githubUserId} AND github_repo_id = ${githubRepoId}
    LIMIT 1
  `;
  return rows.length > 0;
}
