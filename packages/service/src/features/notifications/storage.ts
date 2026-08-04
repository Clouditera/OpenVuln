import type { SeverityCounts } from "@openvuln/shared";
import { emptySeverityCounts } from "@openvuln/shared";
import { getDb } from "../../infra/db/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlLike = any;

export type ScanCompletedPayload = {
  project_id: string;
  full_name: string;
  owner_login: string;
  name: string;
  scan_job_id: string;
  counts: SeverityCounts;
  no_value: boolean;
};

/**
 * Insert scan_completed notification for project submitter (same txn as completion).
 * Skips when submitted_by is NULL (legacy projects).
 */
export async function insertScanCompleted(
  sql: SqlLike,
  input: {
    jobId: string;
    projectId: string;
    counts: SeverityCounts;
    noValue: boolean;
  },
): Promise<void> {
  const rows = await sql<
    { submitted_by: string | null; full_name: string; owner_login: string; name: string }[]
  >`
    SELECT submitted_by::text, full_name, owner_login, name
    FROM projects
    WHERE id = ${input.projectId}::uuid
  `;
  const p = rows[0];
  if (!p?.submitted_by) return;

  const payload: ScanCompletedPayload = {
    project_id: input.projectId,
    full_name: p.full_name,
    owner_login: p.owner_login,
    name: p.name,
    scan_job_id: input.jobId,
    counts: input.counts,
    no_value: input.noValue,
  };

  // Pass plain object — postgres.js encodes jsonb. Do NOT JSON.stringify (double-encode).
  await sql`
    INSERT INTO notifications (github_user_id, type, payload)
    VALUES (
      ${Number(p.submitted_by)},
      'scan_completed',
      ${payload as never}
    )
  `;
}

export async function listForUser(
  githubUserId: number,
  limit = 20,
): Promise<{
  items: Array<{
    id: string;
    type: string;
    payload: ScanCompletedPayload;
    read_at: Date | null;
    created_at: Date;
  }>;
  unread_count: number;
}> {
  const db = getDb();
  const lim = Math.min(Math.max(limit, 1), 50);
  const items = await db<
    {
      id: string;
      type: string;
      payload: ScanCompletedPayload;
      read_at: Date | null;
      created_at: Date;
    }[]
  >`
    SELECT id::text, type, payload, read_at, created_at
    FROM notifications
    WHERE github_user_id = ${githubUserId}
    ORDER BY created_at DESC
    LIMIT ${lim}
  `;
  const unreadRows = await db<{ n: string }[]>`
    SELECT count(*)::text AS n FROM notifications
    WHERE github_user_id = ${githubUserId} AND read_at IS NULL
  `;
  return {
    items,
    unread_count: Number(unreadRows[0]?.n ?? 0),
  };
}

export async function markRead(githubUserId: number, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const rows = await db`
    UPDATE notifications
    SET read_at = COALESCE(read_at, now())
    WHERE github_user_id = ${githubUserId}
      AND id = ANY(${ids}::uuid[])
      AND read_at IS NULL
    RETURNING id
  `;
  return rows.length;
}

export async function markReadAll(githubUserId: number): Promise<number> {
  const db = getDb();
  const rows = await db`
    UPDATE notifications
    SET read_at = now()
    WHERE github_user_id = ${githubUserId} AND read_at IS NULL
    RETURNING id
  `;
  return rows.length;
}

export type PendingEmailRow = {
  id: string;
  github_user_id: number;
  email: string;
  payload: ScanCompletedPayload;
  email_attempts: number;
};

export async function listPendingEmail(limit: number): Promise<PendingEmailRow[]> {
  const db = getDb();
  const rows = await db<
    {
      id: string;
      github_user_id: string;
      email: string;
      payload: ScanCompletedPayload;
      email_attempts: number;
    }[]
  >`
    SELECT n.id::text, n.github_user_id::text, i.email, n.payload, n.email_attempts
    FROM notifications n
    JOIN github_identities i ON i.user_id = n.github_user_id
    WHERE n.email_sent_at IS NULL
      AND n.email_attempts < 5
      AND i.email IS NOT NULL
      AND i.email <> ''
    ORDER BY n.created_at ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    github_user_id: Number(r.github_user_id),
    email: r.email,
    payload: r.payload,
    email_attempts: Number(r.email_attempts),
  }));
}

export async function markEmailSent(id: string): Promise<void> {
  const db = getDb();
  await db`
    UPDATE notifications
    SET email_sent_at = now(), email_error = NULL
    WHERE id = ${id}::uuid
  `;
}

export async function markEmailFailed(id: string, error: string): Promise<void> {
  const db = getDb();
  await db`
    UPDATE notifications
    SET email_attempts = email_attempts + 1,
        email_error = ${error.slice(0, 500)}
    WHERE id = ${id}::uuid
  `;
}

/** Skip email forever when user has no address (avoid infinite pending). */
export async function markEmailSkippedNoAddress(limit = 50): Promise<number> {
  const db = getDb();
  const rows = await db`
    UPDATE notifications n
    SET email_sent_at = now(),
        email_error = 'no_email'
    FROM github_identities i
    WHERE i.user_id = n.github_user_id
      AND n.email_sent_at IS NULL
      AND (i.email IS NULL OR i.email = '')
    RETURNING n.id
  `;
  void limit;
  return rows.length;
}

export function emptyCounts(): SeverityCounts {
  return emptySeverityCounts();
}
