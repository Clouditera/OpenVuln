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
  findings_so_far: number;
  consecutive_failures: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

/** Accept root sql or transaction sql (postgres.js). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlLike = any;

export async function createScanJob(
  projectId: string,
  commitSha: string | null,
  gitRef: string | null = null,
): Promise<ScanJobRow> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    INSERT INTO scan_jobs (project_id, state, commit_sha, git_ref)
    VALUES (${projectId}::uuid, 'pending_review', ${commitSha}, ${gitRef})
    RETURNING
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
  `;
  return rows[0];
}

export async function claimQueuedJobs(limit: number): Promise<ScanJobRow[]> {
  if (limit <= 0) return [];
  const db = getDb();
  // Priority: projects.stars DESC, then scan_jobs.created_at ASC
  const rows = await db.begin(async (tx) => {
    const claimed = await tx<ScanJobRow[]>`
      UPDATE scan_jobs
      SET state = 'dispatching', started_at = COALESCE(started_at, now())
      WHERE id IN (
        SELECT j.id
        FROM scan_jobs j
        JOIN projects p ON p.id = j.project_id
        WHERE j.state = 'queued'
        ORDER BY p.stars DESC, j.created_at ASC
        LIMIT ${limit}
        FOR UPDATE OF j SKIP LOCKED
      )
      RETURNING
        id::text, project_id::text, vulnhunter_task_id::text,
        state, commit_sha, attempt, fail_reason_internal,
        COALESCE(findings_so_far, 0) AS findings_so_far,
        COALESCE(consecutive_failures, 0) AS consecutive_failures,
        created_at, started_at, finished_at
    `;
    return claimed;
  });
  return rows;
}

export async function updateFindingsSoFar(
  id: string,
  n: number,
  sql: SqlLike = getDb(),
): Promise<void> {
  await sql`UPDATE scan_jobs SET findings_so_far = ${n} WHERE id = ${id}::uuid`;
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

export async function setCommitSha(id: string, commitSha: string | null): Promise<void> {
  const db = getDb();
  await db`
    UPDATE scan_jobs SET commit_sha = ${commitSha} WHERE id = ${id}::uuid
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

/**
 * VH task confirmed deleted (404 + ERR_TASK_NOT_FOUND).
 * Deletes the scan_job; if the project has no remaining jobs, deletes the project too
 * (cascades findings when present). Clears current_scan_job_id when it pointed here.
 * Returns whether the project row was removed.
 */
export async function hardDeleteGoneJob(
  jobId: string,
  projectId: string,
): Promise<{ projectDeleted: boolean }> {
  const db = getDb();
  return db.begin(async (tx) => {
    await tx`
      UPDATE projects
      SET current_scan_job_id = NULL
      WHERE id = ${projectId}::uuid
        AND current_scan_job_id = ${jobId}::uuid
    `;
    // findings / artifacts: no full CASCADE on scan_job_id — delete dependents first
    await tx`DELETE FROM finding_artifacts WHERE finding_id IN (SELECT id FROM findings WHERE scan_job_id = ${jobId}::uuid)`;
    await tx`DELETE FROM findings WHERE scan_job_id = ${jobId}::uuid`;
    await tx`DELETE FROM scan_jobs WHERE id = ${jobId}::uuid`;
    const remaining = await tx<{ n: string }[]>`
      SELECT count(*)::text AS n FROM scan_jobs WHERE project_id = ${projectId}::uuid
    `;
    const n = Number(remaining[0]?.n ?? 0);
    if (n === 0) {
      await tx`DELETE FROM projects WHERE id = ${projectId}::uuid`;
      return { projectDeleted: true };
    }
    return { projectDeleted: false };
  });
}

/** dispatching jobs whose started_at is older than staleMinutes. */
export async function listStaleDispatching(staleMinutes: number): Promise<ScanJobRow[]> {
  const db = getDb();
  return db<ScanJobRow[]>`
    SELECT
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
    FROM scan_jobs
    WHERE state = 'dispatching'
      AND started_at IS NOT NULL
      AND started_at < now() - make_interval(mins => ${staleMinutes})
    ORDER BY started_at ASC
  `;
}

/** Manual finalize: scanning|dispatching → failed. Returns null if not eligible. */
export async function finalizeInFlight(
  id: string,
  reason: string,
): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    UPDATE scan_jobs
    SET state = 'failed',
        fail_reason_internal = ${reason.slice(0, 2000)},
        finished_at = now()
    WHERE id = ${id}::uuid
      AND state IN ('scanning', 'dispatching')
    RETURNING
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
  `;
  return rows[0] ?? null;
}

export async function markCompleted(id: string, sql: SqlLike = getDb()): Promise<void> {
  await sql`
    UPDATE scan_jobs
    SET state = 'completed', finished_at = now(), consecutive_failures = 0
    WHERE id = ${id}::uuid
  `;
}

/** Return a claimed job to queued for another dispatch attempt. */
export async function requeueDispatching(id: string, reason: string): Promise<void> {
  const db = getDb();
  await db`
    UPDATE scan_jobs
    SET state = 'queued',
        attempt = attempt + 1,
        fail_reason_internal = ${reason.slice(0, 2000)},
        started_at = NULL,
        vulnhunter_task_id = NULL
    WHERE id = ${id}::uuid AND state = 'dispatching'
  `;
}

export async function bumpConsecutiveFailures(id: string): Promise<number> {
  const db = getDb();
  const rows = await db<{ n: number }[]>`
    UPDATE scan_jobs
    SET consecutive_failures = consecutive_failures + 1
    WHERE id = ${id}::uuid
    RETURNING consecutive_failures AS n
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function resetConsecutiveFailures(id: string): Promise<void> {
  const db = getDb();
  await db`UPDATE scan_jobs SET consecutive_failures = 0 WHERE id = ${id}::uuid`;
}

export async function setCurrentScanJob(
  projectId: string,
  scanJobId: string,
  sql: SqlLike = getDb(),
): Promise<void> {
  await sql`
    UPDATE projects
    SET current_scan_job_id = ${scanJobId}::uuid
    WHERE id = ${projectId}::uuid
  `;
}

/** Move failed job back to scanning so poller can resync a completed VH task. */
export async function reviveFailedForResync(id: string): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    UPDATE scan_jobs
    SET state = 'scanning',
        fail_reason_internal = NULL,
        finished_at = NULL,
        consecutive_failures = 0
    WHERE id = ${id}::uuid
      AND state = 'failed'
      AND vulnhunter_task_id IS NOT NULL
    RETURNING
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
  `;
  return rows[0] ?? null;
}

export async function listScanningJobs(): Promise<ScanJobRow[]> {
  const db = getDb();
  return db<ScanJobRow[]>`
    SELECT
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
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
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
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
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
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
        findings_so_far = 0,
        consecutive_failures = 0,
        started_at = NULL,
        finished_at = NULL
    WHERE id = ${id}::uuid AND state = 'failed'
    RETURNING
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
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
      COALESCE(j.findings_so_far, 0) AS findings_so_far,
      COALESCE(j.consecutive_failures, 0) AS consecutive_failures,
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
      p.stars DESC,
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

/** Find completed scan for a specific commit (idempotent check). */
export async function findCompletedBySha(
  projectId: string,
  commitSha: string,
): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    SELECT
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
    FROM scan_jobs
    WHERE project_id = ${projectId}::uuid
      AND commit_sha = ${commitSha}
      AND state = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Find any in-flight job for a project (any version). */
export async function findInFlight(projectId: string): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    SELECT
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
    FROM scan_jobs
    WHERE project_id = ${projectId}::uuid
      AND state IN ('pending_review', 'queued', 'dispatching', 'scanning')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Mark job as cancelled (releases the partial unique index slot). */
export async function markCancelled(id: string, reason: string | null = null): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    UPDATE scan_jobs
    SET state = 'cancelled',
        fail_reason_internal = ${reason ? reason.slice(0, 2000) : 'cancelled_by_user'},
        finished_at = now()
    WHERE id = ${id}::uuid
      AND state IN ('pending_review', 'queued', 'dispatching', 'scanning')
    RETURNING
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
  `;
  return rows[0] ?? null;
}

/** List completed scans for a project (version history). */
export async function listCompletedScans(projectId: string): Promise<ScanJobRow[]> {
  const db = getDb();
  return db<ScanJobRow[]>`
    SELECT
      j.id::text, j.project_id::text, j.vulnhunter_task_id::text,
      j.state, j.commit_sha, j.attempt, j.fail_reason_internal,
      COALESCE(j.findings_so_far, 0) AS findings_so_far,
      COALESCE(j.consecutive_failures, 0) AS consecutive_failures,
      j.created_at, j.started_at, j.finished_at
    FROM scan_jobs j
    WHERE j.project_id = ${projectId}::uuid
      AND j.state = 'completed'
    ORDER BY j.created_at DESC
  `;
}

/** List all scans for a project (owner view). */
export async function listAllScans(projectId: string): Promise<ScanJobRow[]> {
  const db = getDb();
  return db<ScanJobRow[]>`
    SELECT
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
    FROM scan_jobs
    WHERE project_id = ${projectId}::uuid
    ORDER BY created_at DESC
  `;
}

/** List pending_review with stars for auto-approve sorting. */
export async function listPendingReviewWithStars(): Promise<
  Array<{
    id: string;
    project_id: string;
    full_name: string;
    stars: number | null;
    created_at: Date;
  }>
> {
  const db = getDb();
  return db`
    SELECT
      j.id::text, j.project_id::text, j.created_at,
      p.full_name, p.stars
    FROM scan_jobs j
    JOIN projects p ON p.id = j.project_id
    WHERE j.state = 'pending_review'
    ORDER BY j.created_at ASC
  `;
}

/** List all pending_review jobs (admin queue). */
export async function listPendingReview(): Promise<
  Array<{
    id: string;
    project_id: string;
    vulnhunter_task_id: string | null;
    state: ScanJobState;
    commit_sha: string | null;
    git_ref: string | null;
    attempt: number;
    fail_reason_internal: string | null;
    findings_so_far: number;
    consecutive_failures: number;
    created_at: Date;
    started_at: Date | null;
    finished_at: Date | null;
    full_name: string;
    html_url: string;
    submitted_by: number | null;
    submitter_login: string | null;
    submitter_email: string | null;
    submitter_avatar: string | null;
    stars: number | null;
    description: string | null;
    language: string | null;
  }>
> {
  const db = getDb();
  return db`
    SELECT
      j.id::text, j.project_id::text, j.vulnhunter_task_id::text,
      j.state, j.commit_sha, j.git_ref, j.attempt, j.fail_reason_internal,
      COALESCE(j.findings_so_far, 0) AS findings_so_far,
      COALESCE(j.consecutive_failures, 0) AS consecutive_failures,
      j.created_at, j.started_at, j.finished_at,
      p.full_name, p.html_url, p.submitted_by, p.stars, p.description, p.language,
      i.login AS submitter_login,
      i.email AS submitter_email,
      i.avatar_url AS submitter_avatar
    FROM scan_jobs j
    JOIN projects p ON p.id = j.project_id
    LEFT JOIN github_identities i ON i.user_id = p.submitted_by
    WHERE j.state = 'pending_review'
    ORDER BY j.created_at ASC
  `;
}

/** Approve: pending_review → queued. */
export async function approveScanJob(
  jobId: string,
): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    UPDATE scan_jobs
    SET state = 'queued'
    WHERE id = ${jobId}::uuid
      AND state = 'pending_review'
    RETURNING
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
  `;
  return rows[0] ?? null;
}

/** Reject: pending_review → rejected (terminal). */
export async function rejectScanJob(
  jobId: string,
  reason: string | null,
): Promise<ScanJobRow | null> {
  const db = getDb();
  const rows = await db<ScanJobRow[]>`
    UPDATE scan_jobs
    SET state = 'rejected',
        fail_reason_internal = ${reason ? reason.slice(0, 2000) : 'rejected_by_admin'},
        finished_at = now()
    WHERE id = ${jobId}::uuid
      AND state = 'pending_review'
    RETURNING
      id::text, project_id::text, vulnhunter_task_id::text,
      state, commit_sha, attempt, fail_reason_internal,
      COALESCE(findings_so_far, 0) AS findings_so_far,
      COALESCE(consecutive_failures, 0) AS consecutive_failures,
      created_at, started_at, finished_at
  `;
  return rows[0] ?? null;
}

// ── VH teardown queue (async delete after user cancel) ──────────────────────

export interface TeardownRow {
  id: string;
  vh_task_id: string;
  attempts: number;
  next_retry_at: Date;
  last_error: string | null;
  created_at: Date;
}

/** Enqueue VH task for background delete. Idempotent on vh_task_id. */
export async function enqueueVhTeardown(vhTaskId: string): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO vh_teardown_queue (vh_task_id, next_retry_at)
    VALUES (${vhTaskId}, now())
    ON CONFLICT (vh_task_id) DO NOTHING
  `;
}

/** Claim due teardown rows (limit), ordered by next_retry_at. */
export async function claimDueTeardowns(limit = 5): Promise<TeardownRow[]> {
  const db = getDb();
  return db<TeardownRow[]>`
    SELECT id::text, vh_task_id, attempts, next_retry_at, last_error, created_at
    FROM vh_teardown_queue
    WHERE next_retry_at <= now()
    ORDER BY next_retry_at ASC
    LIMIT ${limit}
  `;
}

export async function removeTeardown(id: string): Promise<void> {
  const db = getDb();
  await db`DELETE FROM vh_teardown_queue WHERE id = ${id}::uuid`;
}

/** Exponential backoff: 30s * 2^attempts, cap 30min. */
export function teardownBackoffSeconds(attemptsAfterBump: number): number {
  const base = 30 * 2 ** Math.max(0, attemptsAfterBump - 1);
  return Math.min(base, 30 * 60);
}

export async function bumpTeardownRetry(
  id: string,
  errMsg: string,
): Promise<{ attempts: number }> {
  const db = getDb();
  // Read current attempts, then set next_retry from JS backoff
  const cur = await db<{ attempts: number }[]>`
    SELECT attempts FROM vh_teardown_queue WHERE id = ${id}::uuid
  `;
  const nextAttempts = (cur[0]?.attempts ?? 0) + 1;
  const delaySec = teardownBackoffSeconds(nextAttempts);
  const rows = await db<{ attempts: number }[]>`
    UPDATE vh_teardown_queue
    SET attempts = ${nextAttempts},
        last_error = ${errMsg.slice(0, 500)},
        next_retry_at = now() + (${delaySec}::text || ' seconds')::interval
    WHERE id = ${id}::uuid
    RETURNING attempts
  `;
  return { attempts: rows[0]?.attempts ?? nextAttempts };
}

export async function countTeardownQueue(): Promise<number> {
  const db = getDb();
  const rows = await db<{ n: string }[]>`SELECT count(*)::text AS n FROM vh_teardown_queue`;
  return Number(rows[0]?.n ?? 0);
}
