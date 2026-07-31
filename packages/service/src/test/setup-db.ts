/**
 * Integration test helpers. Requires DATABASE_URL pointing at a real Postgres.
 * docker compose -f deploy/docker-compose.yml up -d postgres
 */
import { randomUUID } from "node:crypto";
import { initDb, closeDb, getDb, runMigrations } from "../infra/db/index.js";
import { loadConfig } from "../infra/config.js";
import { initVulnHunterClient, setVulnHunterClient, MockVulnHunterClient } from "../features/vulnhunter/index.js";
import { createApp } from "../server.js";
import type { ServiceConfig } from "../infra/config.js";
import type { Hono } from "hono";

export interface TestContext {
  app: Hono;
  config: ServiceConfig;
  mockVh: MockVulnHunterClient;
  db: ReturnType<typeof getDb>;
}

let started = false;

export async function setupTestApp(): Promise<TestContext> {
  process.env.VULNHUNTER_MOCK = "true";
  process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret";
  process.env.ADMIN_GITHUB_LOGINS = "adminuser";
  // ALWAYS use isolated test DB — never the demo/dev database (avoids wiping seed data).
  // Override with TEST_DATABASE_URL if needed; ignore ambient DATABASE_URL pointing at demo.
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    "postgresql://openvuln:openvuln@localhost:5433/openvuln_test";

  const config = loadConfig();
  if (!started) {
    await initDb(config.db.url);
    await runMigrations();
    started = true;
  }

  const mockVh = new MockVulnHunterClient({ completeAfterMs: 1 });
  initVulnHunterClient(config);
  setVulnHunterClient(mockVh);

  const app = createApp(config);
  return { app, config, mockVh, db: getDb() };
}

export async function teardownTestApp(): Promise<void> {
  // Keep DB open across files; process exit closes.
}

export async function cleanTables(): Promise<void> {
  const db = getDb();
  await db`TRUNCATE findings, scan_jobs, repo_access_grants, sessions, projects, github_identities CASCADE`;
}

export async function seedProject(opts?: {
  fullName?: string;
  repoId?: number;
}): Promise<{ projectId: string; repoId: number; fullName: string }> {
  const db = getDb();
  const repoId = opts?.repoId ?? Math.floor(Math.random() * 1_000_000_000);
  const fullName = opts?.fullName ?? `testorg/repo-${randomUUID().slice(0, 8)}`;
  const [owner, name] = fullName.split("/");
  const rows = await db<{ id: string }[]>`
    INSERT INTO projects (github_repo_id, owner_login, name, full_name, html_url, default_branch, stars)
    VALUES (
      ${repoId}, ${owner}, ${name}, ${fullName},
      ${`https://github.com/${fullName}`}, 'main', 10
    )
    RETURNING id::text
  `;
  return { projectId: rows[0].id, repoId, fullName };
}

export async function seedFinding(
  projectId: string,
  scanJobId: string,
  opts?: { key?: string; disclosure?: "owner_only" | "disclosed"; title?: string },
): Promise<string> {
  const db = getDb();
  const key = opts?.key ?? `finding-${randomUUID().slice(0, 8)}`;
  const disclosure = opts?.disclosure ?? "owner_only";
  const title = opts?.title ?? "Secret finding title";
  const rows = await db<{ id: string }[]>`
    INSERT INTO findings (
      project_id, scan_job_id, finding_key, severity, title, cwe, primary_file,
      detail_json, disclosure_state, disclosed_at
    ) VALUES (
      ${projectId}::uuid, ${scanJobId}::uuid, ${key}, 'high', ${title},
      'CWE-89', 'src/secret.ts',
      ${JSON.stringify({ description: "should never leak publicly" })}::jsonb,
      ${disclosure},
      ${disclosure === "disclosed" ? new Date() : null}
    )
    RETURNING id::text
  `;
  return rows[0].id;
}

export async function seedScanJob(projectId: string, state = "completed"): Promise<string> {
  const db = getDb();
  const rows = await db<{ id: string }[]>`
    INSERT INTO scan_jobs (project_id, state, commit_sha, finished_at)
    VALUES (
      ${projectId}::uuid, ${state}, 'abc123',
      ${state === "completed" || state === "failed" ? new Date() : null}
    )
    RETURNING id::text
  `;
  return rows[0].id;
}

export async function seedSession(login: string, githubUserId: number, isGrantRepoId?: number) {
  const db = getDb();
  await db`
    INSERT INTO github_identities (user_id, login, avatar_url)
    VALUES (${githubUserId}, ${login}, null)
    ON CONFLICT (user_id) DO UPDATE SET login = EXCLUDED.login
  `;
  if (isGrantRepoId != null) {
    await db`
      INSERT INTO repo_access_grants (github_user_id, github_repo_id, role)
      VALUES (${githubUserId}, ${isGrantRepoId}, 'admin')
      ON CONFLICT (github_user_id, github_repo_id) DO NOTHING
    `;
  }
  // Create session via storage to get proper hash
  const { createSession } = await import("../features/auth/session.js");
  const { token } = await createSession(githubUserId);
  return token;
}

export { closeDb };
