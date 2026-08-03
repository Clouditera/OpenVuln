import { getDb } from "../../infra/db/index.js";

export interface ProjectRow {
  id: string;
  github_repo_id: string;
  owner_login: string;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stars: number;
  default_branch: string;
  created_at: Date;
  updated_at: Date;
  removed_at: Date | null;
}

/** True when postgres unique_violation (23505). */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint_name?: string; constraint?: string };
  return e.code === "23505";
}

export async function insertProject(input: {
  githubRepoId: number;
  ownerLogin: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  stars: number;
  defaultBranch: string;
  submittedBy?: number | null;
}): Promise<ProjectRow> {
  const db = getDb();
  const rows = await db<ProjectRow[]>`
    INSERT INTO projects (
      github_repo_id, owner_login, name, full_name, html_url,
      description, language, stars, default_branch, submitted_by
    ) VALUES (
      ${input.githubRepoId}, ${input.ownerLogin}, ${input.name}, ${input.fullName},
      ${input.htmlUrl}, ${input.description}, ${input.language}, ${input.stars},
      ${input.defaultBranch}, ${input.submittedBy ?? null}
    )
    RETURNING
      id::text, github_repo_id::text, owner_login, name, full_name, html_url,
      description, language, stars, default_branch, created_at, updated_at, removed_at
  `;
  return rows[0];
}

export async function findByRepoId(githubRepoId: number): Promise<ProjectRow | null> {
  const db = getDb();
  const rows = await db<ProjectRow[]>`
    SELECT
      id::text, github_repo_id::text, owner_login, name, full_name, html_url,
      description, language, stars, default_branch, created_at, updated_at, removed_at
    FROM projects
    WHERE github_repo_id = ${githubRepoId} AND removed_at IS NULL
  `;
  return rows[0] ?? null;
}

export async function findByFullName(owner: string, repo: string): Promise<ProjectRow | null> {
  const db = getDb();
  const fullName = `${owner}/${repo}`;
  const rows = await db<ProjectRow[]>`
    SELECT
      id::text, github_repo_id::text, owner_login, name, full_name, html_url,
      description, language, stars, default_branch, created_at, updated_at, removed_at
    FROM projects
    WHERE lower(full_name) = lower(${fullName}) AND removed_at IS NULL
  `;
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<ProjectRow | null> {
  const db = getDb();
  const rows = await db<ProjectRow[]>`
    SELECT
      id::text, github_repo_id::text, owner_login, name, full_name, html_url,
      description, language, stars, default_branch, created_at, updated_at, removed_at
    FROM projects
    WHERE id = ${id}::uuid AND removed_at IS NULL
  `;
  return rows[0] ?? null;
}

export async function listProjects(opts: {
  sort: "newest" | "stars";
  page: number;
  pageSize: number;
}): Promise<{ rows: ProjectRow[]; total: number }> {
  const db = getDb();
  const offset = (opts.page - 1) * opts.pageSize;

  const countRows = await db<{ n: string }[]>`
    SELECT count(*)::text AS n FROM projects WHERE removed_at IS NULL
  `;
  const total = Number(countRows[0]?.n ?? 0);

  const orderSql =
    opts.sort === "stars"
      ? db`ORDER BY stars DESC, created_at DESC`
      : db`ORDER BY created_at DESC`;

  const rows = await db<ProjectRow[]>`
    SELECT
      id::text, github_repo_id::text, owner_login, name, full_name, html_url,
      description, language, stars, default_branch, created_at, updated_at, removed_at
    FROM projects
    WHERE removed_at IS NULL
    ${orderSql}
    LIMIT ${opts.pageSize} OFFSET ${offset}
  `;

  return { rows, total };
}

export async function softDelete(id: string): Promise<boolean> {
  const db = getDb();
  const rows = await db`
    UPDATE projects SET removed_at = now(), updated_at = now()
    WHERE id = ${id}::uuid AND removed_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function countActive(): Promise<number> {
  const db = getDb();
  const rows = await db<{ n: string }[]>`
    SELECT count(*)::text AS n FROM projects WHERE removed_at IS NULL
  `;
  return Number(rows[0]?.n ?? 0);
}
