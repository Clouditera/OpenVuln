import type { ScanJobState } from "@openvuln/shared";
import { getDb } from "../../infra/db/index.js";

export interface ScanJobRow {
  id: string;
  project_id: string;
  vulnhunter_task_id: string | null;
  state: ScanJobState;
  commit_sha: string | null;
  attempt: number;
  fail_reason_internal: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export async function createScanJob(projectId: string, commitSha: string | null): Promise<ScanJobRow> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    INSERT INTO scan_jobs (project_id, state, commit_sha)
    VALUES (${projectId}::uuid, 'queued', ${commitSha})
    RETURNING
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      created_at, started_at, finished_at
  `;
  return rows[0];
}

export async function claimQueuedJobs(limit: number): Promise<ScanJobRow[]> {
  if (limit <= 0) return [];
  const db = getDb();
  // FOR UPDATE SKIP LOCKED — safe for multi-instance; fine for single too
  const rows = await db.begin(async (tx) => {
    const claimed = await tx<ScanJobRow[]>`
      UPDATE scan_jobs
      SET state = 'dispatching', started_at = COALESCE(started_at, now())
      WHERE id IN (
        SELECT id FROM scan_jobs
        WHERE state = 'queued'
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id::text, project_id::text, vulnhunter_task_id::text,
        state, commit_sha, attempt, fail_reason_internal,
        created_at, started_at, finished_at
    `;
    return claimed;
  });
  return rows;
}

export async function countInFlight(): Promise<number> {
  const db = getDb();
  const rows = await db<{ n: string }[]>`
    SELECT count(*)::text AS n FROM scan_jobs
    WHERE state IN ('dispatching', 'scanning')
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function markScanning(id: string, vhTaskId: string): Promise<void> {
  const db = getDb();
  await db`
    UPDATE scan_jobs
    SET state = 'scanning', vulnhunter_task_id = ${vhTaskId}::uuid
    WHERE id = ${id}::uuid
  `;
}

export async function markFailed(id: string, reason: string): Promise<void> {
  const db = getDb();
  await db`
    UPDATE scan_jobs
    SET state = 'failed', fail_reason_internal = ${reason}, finished_at = now()
    WHERE id = ${id}::uuid
  `;
}

export async function markCompleted(id: string): Promise<void> {
  const db = getDb();
  await db`
    UPDATE scan_jobs
    SET state = 'completed', finished_at = now()
    WHERE id = ${id}::uuid
  `;
}

export async function listScanningJobs(): Promise<ScanJobRow[]> {
  const db = getDb();
  return db<ScanJobRow[]>`
    SELECT
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      created_at, started_at, finished_at
    FROM scan_jobs
    WHERE state = 'scanning' AND vulnhunter_task_id IS NOT NULL
    ORDER BY created_at ASC
  `;
}

export async function getLatestScanForProject(projectId: string): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    SELECT
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      created_at, started_at, finished_at
    FROM scan_jobs
    WHERE project_id = ${projectId}::uuid
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getScanJob(id: string): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    SELECT
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      created_at, started_at, finished_at
    FROM scan_jobs WHERE id = ${id}::uuid
  `;
  return rows[0] ?? null;
}

export async function retryScanJob(id: string): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    UPDATE scan_jobs
    SET state = 'queued',
        attempt = attempt + 1,
        fail_reason_internal = NULL,
        vulnhunter_task_id = NULL,
        started_at = NULL,
        finished_at = NULL
    WHERE id = ${id}::uuid AND state = 'failed'
    RETURNING
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      created_at, started_at, finished_at
  `;
  return rows[0] ?? null;
}

export async function listQueue(limit = 100): Promise<
  Array<ScanJobRow & { project_full_name: string }>
> {
  const db = getDb();
  return db<(ScanJobRow & { project_full_name: string })[]>`
    SELECT
      j.id::text, j.project_id::text, j.vulnhunter_task_id::text,
      j.state, j.commit_sha, j.attempt, j.fail_reason_internal,
      j.created_at, j.started_at, j.finished_at,
      p.full_name AS project_full_name
    FROM scan_jobs j
    JOIN projects p ON p.id = j.project_id
    WHERE j.state IN ('queued', 'dispatching', 'scanning', 'failed')
    ORDER BY
      CASE j.state
        WHEN 'scanning' THEN 0
        WHEN 'dispatching' THEN 1
        WHEN 'queued' THEN 2
        ELSE 3
      END,
      j.created_at ASC
    LIMIT ${limit}
  `;
}

export async function lastScanCreatedAt(projectId: string): Promise<Date | null> {
  const db = getDb();
  const rows = await db<{ created_at: Date }[]>`
    SELECT created_at FROM scan_jobs
    WHERE project_id = ${projectId}::uuid
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0]?.created_at ?? null;
}
