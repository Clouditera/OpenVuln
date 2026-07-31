import type { DisclosureState, Severity } from "@openvuln/shared";
import { getDb } from "../../infra/db/index.js";

export interface FindingRow {
  id: string;
  project_id: string;
  scan_job_id: string;
  finding_key: string;
  severity: Severity;
  title: string;
  cwe: string | null;
  primary_file: string | null;
  detail_json: unknown;
  disclosure_state: DisclosureState;
  disclosed_at: Date | null;
  disclosed_by: string | null;
}

export async function upsertFinding(input: {
  projectId: string;
  scanJobId: string;
  findingKey: string;
  severity: Severity;
  title: string;
  cwe: string | null;
  primaryFile: string | null;
  detailJson: unknown;
  disclosureState?: DisclosureState;
  disclosedAt?: Date | null;
  disclosedBy?: number | null;
}): Promise<void> {
  const db = getDb();
  const detail = JSON.stringify(input.detailJson ?? null);
  const disclosureState = input.disclosureState ?? "owner_only";
  const disclosedAt = input.disclosedAt ?? null;
  const disclosedBy = input.disclosedBy ?? null;
  await db`
    INSERT INTO findings (
      project_id, scan_job_id, finding_key, severity, title, cwe, primary_file, detail_json,
      disclosure_state, disclosed_at, disclosed_by
    ) VALUES (
      ${input.projectId}::uuid,
      ${input.scanJobId}::uuid,
      ${input.findingKey},
      ${input.severity},
      ${input.title},
      ${input.cwe},
      ${input.primaryFile},
      ${detail}::jsonb,
      ${disclosureState},
      ${disclosedAt},
      ${disclosedBy}
    )
    ON CONFLICT (scan_job_id, finding_key) DO UPDATE SET
      severity = EXCLUDED.severity,
      title = EXCLUDED.title,
      cwe = EXCLUDED.cwe,
      primary_file = EXCLUDED.primary_file,
      detail_json = EXCLUDED.detail_json
  `;
}

/** Prior disclosure decisions keyed by finding_key (survive rescan/replace). */
export async function listDisclosureByKey(
  projectId: string,
): Promise<Map<string, { state: DisclosureState; disclosedAt: Date | null; disclosedBy: number | null }>> {
  const db = getDb();
  const rows = await db<
    { finding_key: string; disclosure_state: DisclosureState; disclosed_at: Date | null; disclosed_by: string | null }[]
  >`
    SELECT finding_key, disclosure_state, disclosed_at, disclosed_by::text
    FROM findings
    WHERE project_id = ${projectId}::uuid AND disclosure_state = 'disclosed'
  `;
  const map = new Map<
    string,
    { state: DisclosureState; disclosedAt: Date | null; disclosedBy: number | null }
  >();
  for (const r of rows) {
    map.set(r.finding_key, {
      state: r.disclosure_state,
      disclosedAt: r.disclosed_at,
      disclosedBy: r.disclosed_by != null ? Number(r.disclosed_by) : null,
    });
  }
  return map;
}

/**
 * Replace project findings with a fresh scan result set.
 * Latest completed scan is the single source of truth for public stats (BUG-1).
 */
export async function deleteAllForProject(projectId: string): Promise<number> {
  const db = getDb();
  const rows = await db<{ id: string }[]>`
    DELETE FROM findings
    WHERE project_id = ${projectId}::uuid
    RETURNING id::text
  `;
  return rows.length;
}

/** Public aggregate only — never returns titles/paths for owner_only. */
export async function severityCounts(projectId: string): Promise<Record<Severity, number>> {
  const db = getDb();
  const rows = await db<{ severity: Severity; n: string }[]>`
    SELECT severity, count(*)::text AS n
    FROM findings
    WHERE project_id = ${projectId}::uuid
    GROUP BY severity
  `;
  const out: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const r of rows) out[r.severity] = Number(r.n);
  return out;
}

export async function severityCountsMany(
  projectIds: string[],
): Promise<Map<string, Record<Severity, number>>> {
  const map = new Map<string, Record<Severity, number>>();
  for (const id of projectIds) {
    map.set(id, { high: 0, medium: 0, low: 0, info: 0 });
  }
  if (projectIds.length === 0) return map;

  const db = getDb();
  const rows = await db<{ project_id: string; severity: Severity; n: string }[]>`
    SELECT project_id::text, severity, count(*)::text AS n
    FROM findings
    WHERE project_id = ANY (${projectIds}::uuid[])
    GROUP BY project_id, severity
  `;
  for (const r of rows) {
    const cur = map.get(r.project_id) ?? { high: 0, medium: 0, low: 0, info: 0 };
    cur[r.severity] = Number(r.n);
    map.set(r.project_id, cur);
  }
  return map;
}

export async function cweDistribution(
  projectId: string,
): Promise<Array<{ cwe: string; count: number }>> {
  const db = getDb();
  const rows = await db<{ cwe: string; n: string }[]>`
    SELECT COALESCE(cwe, 'unknown') AS cwe, count(*)::text AS n
    FROM findings
    WHERE project_id = ${projectId}::uuid
    GROUP BY COALESCE(cwe, 'unknown')
    ORDER BY count(*) DESC
    LIMIT 20
  `;
  return rows.map((r) => ({ cwe: r.cwe, count: Number(r.n) }));
}

/** Public: disclosed findings only — no detail_json. */
export async function listDisclosedSummaries(projectId: string): Promise<
  Array<{
    id: string;
    finding_key: string;
    severity: Severity;
    title: string;
    cwe: string | null;
    disclosed_at: Date | null;
  }>
> {
  const db = getDb();
  return db`
    SELECT id::text, finding_key, severity, title, cwe, disclosed_at
    FROM findings
    WHERE project_id = ${projectId}::uuid AND disclosure_state = 'disclosed'
    ORDER BY
      CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      disclosed_at DESC NULLS LAST
  `;
}

/** Owner-only: full list without detail payload. */
export async function listForOwner(projectId: string): Promise<
  Array<{
    id: string;
    finding_key: string;
    severity: Severity;
    title: string;
    cwe: string | null;
    primary_file: string | null;
    disclosure_state: DisclosureState;
    disclosed_at: Date | null;
  }>
> {
  const db = getDb();
  return db`
    SELECT
      id::text, finding_key, severity, title, cwe, primary_file,
      disclosure_state, disclosed_at
    FROM findings
    WHERE project_id = ${projectId}::uuid
    ORDER BY
      CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      title ASC
  `;
}

/** Owner-only: single finding with detail. */
export async function getForOwner(
  projectId: string,
  findingKey: string,
): Promise<FindingRow | null> {
  const db = getDb();
  const rows = await db<FindingRow[]>`
    SELECT
      id::text, project_id::text, scan_job_id::text, finding_key,
      severity, title, cwe, primary_file, detail_json,
      disclosure_state, disclosed_at, disclosed_by::text
    FROM findings
    WHERE project_id = ${projectId}::uuid AND finding_key = ${findingKey}
  `;
  return rows[0] ?? null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function discloseFindings(
  projectId: string,
  findingIds: string[],
  byGithubUserId: number,
): Promise<string[]> {
  if (findingIds.length === 0) return [];
  const db = getDb();
  const rows = await db<{ id: string }[]>`
    UPDATE findings
    SET
      disclosure_state = 'disclosed',
      disclosed_at = now(),
      disclosed_by = ${byGithubUserId}
    WHERE project_id = ${projectId}::uuid
      AND id = ANY (${findingIds}::uuid[])
      AND disclosure_state = 'owner_only'
    RETURNING id::text
  `;
  return rows.map((r) => r.id);
}

export async function platformSeverityCounts(): Promise<Record<Severity, number>> {
  const db = getDb();
  const rows = await db<{ severity: Severity; n: string }[]>`
    SELECT f.severity, count(*)::text AS n
    FROM findings f
    JOIN projects p ON p.id = f.project_id AND p.removed_at IS NULL
    GROUP BY f.severity
  `;
  const out: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const r of rows) out[r.severity] = Number(r.n);
  return out;
}

export async function platformFindingTotals(): Promise<{ total: number; disclosed: number }> {
  const db = getDb();
  const rows = await db<{ total: string; disclosed: string }[]>`
    SELECT
      count(*)::text AS total,
      count(*) FILTER (WHERE f.disclosure_state = 'disclosed')::text AS disclosed
    FROM findings f
    JOIN projects p ON p.id = f.project_id AND p.removed_at IS NULL
  `;
  return {
    total: Number(rows[0]?.total ?? 0),
    disclosed: Number(rows[0]?.disclosed ?? 0),
  };
}
