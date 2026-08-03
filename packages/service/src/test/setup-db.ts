/**
 * Integration test helpers. Always uses openvuln_test — never the demo DB.
 */
import { randomUUID } from "node:crypto";
import { generateAdminKeyPair } from "@openvuln/shared/crypto";
import type { Hono } from "hono";
import type { ServiceConfig } from "../infra/config.js";
import { loadConfig } from "../infra/config.js";
import { closeDb, getDb, initDb, runMigrations } from "../infra/db/index.js";
import { initVulnHunterClient, setVulnHunterClient } from "../features/vulnhunter/index.js";
import { createApp } from "../server.js";
import { MockVulnHunterClient } from "./fixtures/mock-vh-client.js";

export interface TestContext {
  app: Hono;
  config: ServiceConfig;
  mockVh: MockVulnHunterClient;
  db: ReturnType<typeof getDb>;
  adminKeys: ReturnType<typeof generateAdminKeyPair>;
}

let started = false;
let adminKeys: ReturnType<typeof generateAdminKeyPair> | null = null;

export async function setupTestApp(): Promise<TestContext> {
  // Fixture VH client only — product code has no mock mode.
  // Avoid codeload.github.com during dispatch tests.
  process.env.VH_SOURCE_MODE = "git";
  process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "test-admin-token";
  process.env.VULNHUNTER_AUTH_MODE = process.env.VULNHUNTER_AUTH_MODE ?? "token";
  process.env.VULNHUNTER_API_TOKEN = process.env.VULNHUNTER_API_TOKEN ?? "test-vh-token";
  delete process.env.VULNHUNTER_MOCK;
  if (!adminKeys) {
    adminKeys = generateAdminKeyPair();
    process.env.ADMIN_PUBLIC_KEY = adminKeys.publicKeyEnv;
  }
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    "postgresql://openvuln:openvuln@127.0.0.1:5434/openvuln_test";

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
  return { app, config, mockVh, db: getDb(), adminKeys };
}

export async function cleanTables(): Promise<void> {
  const db = getDb();
  await db`
    TRUNCATE findings, finding_artifacts, scan_jobs, projects, admin_nonces,
      sessions, github_identities, repo_access_grants, submit_rate_limits, notifications
    CASCADE
  `;
}

export async function seedProject(opts?: {
  fullName?: string;
  repoId?: number;
  stars?: number;
}): Promise<{ projectId: string; repoId: number; fullName: string }> {
  const db = getDb();
  const repoId = opts?.repoId ?? Math.floor(Math.random() * 1_000_000_000);
  const fullName = opts?.fullName ?? `testorg/repo-${randomUUID().slice(0, 8)}`;
  const [owner, name] = fullName.split("/");
  const stars = opts?.stars ?? 10;
  const rows = await db<{ id: string }[]>`
    INSERT INTO projects (github_repo_id, owner_login, name, full_name, html_url, default_branch, stars)
    VALUES (
      ${repoId}, ${owner}, ${name}, ${fullName},
      ${`https://github.com/${fullName}`}, 'main', ${stars}
    )
    RETURNING id::text
  `;
  return { projectId: rows[0].id, repoId, fullName };
}

export async function seedFinding(
  projectId: string,
  scanJobId: string,
  opts?: {
    key?: string;
    disclosure?: "owner_only" | "disclosed";
    title?: string;
    severity?: string;
    cvssScore?: number;
  },
): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  const key = opts?.key ?? `finding-${randomUUID().slice(0, 8)}`;
  const disclosure = opts?.disclosure ?? "owner_only";
  const title = opts?.title ?? "Secret finding title";
  const severity = opts?.severity ?? "high";
  const cvss = opts?.cvssScore ?? 7.5;
  const detailJson = {
    title,
    primary_file: "src/secret.ts",
    detail: { description: "should never leak publicly" },
  };
  await db`
    INSERT INTO findings (
      id, project_id, scan_job_id, finding_key, severity, cwe,
      enc_payload, title, primary_file, detail_json,
      disclosure_state, disclosed_at, disclosed_title,
      cvss_score, item_type, poc_status
    ) VALUES (
      ${id}::uuid, ${projectId}::uuid, ${scanJobId}::uuid, ${key}, ${severity},
      'CWE-89', ${""}, ${title}, ${"src/secret.ts"}, ${JSON.stringify(detailJson)}::jsonb,
      ${disclosure},
      ${disclosure === "disclosed" ? new Date() : null},
      ${disclosure === "disclosed" ? title : null},
      ${cvss}, 'finding', 'confirmed'
    )
  `;
  return id;
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
  const jobId = rows[0].id;
  if (state === "completed") {
    await db`
      UPDATE projects SET current_scan_job_id = ${jobId}::uuid WHERE id = ${projectId}::uuid
    `;
  }
  return jobId;
}

export { closeDb };
