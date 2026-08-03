import {
  type DisclosureState,
  type Severity,
  type SeverityCounts,
  emptySeverityCounts,
  isPublicSeverity,
} from "@openvuln/shared";
import { getDb } from "../../infra/db/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlLike = any;

export interface FindingRow {
  id: string;
  project_id: string;
  scan_job_id: string;
  finding_key: string;
  severity: string;
  cwe: string | null;
  enc_payload: string;
  disclosure_state: DisclosureState;
  disclosed_at: Date | null;
  disclosed_title: string | null;
  disclosed_summary: string | null;
  cvss_score: number | null;
  cvss_vector: string | null;
  poc_status: string | null;
}

export async function listDisclosureByKey(
  projectId: string,
  sql: SqlLike = getDb(),
): Promise<
  Map<
    string,
    {
      state: DisclosureState;
      disclosedAt: Date | null;
      disclosedTitle: string | null;
      disclosedSummary: string | null;
      disclosedReportYaml: string | null;
    }
  >
> {
  const rows = await sql`
    SELECT finding_key, disclosure_state, disclosed_at, disclosed_title, disclosed_summary,
           disclosed_report_yaml
    FROM findings
    WHERE project_id = ${projectId}::uuid AND disclosure_state = 'disclosed'
  `;
  const map = new Map<
    string,
    {
      state: DisclosureState;
      disclosedAt: Date | null;
      disclosedTitle: string | null;
      disclosedSummary: string | null;
      disclosedReportYaml: string | null;
    }
  >();
  for (const r of rows) {
    map.set(r.finding_key, {
      state: r.disclosure_state,
      disclosedAt: r.disclosed_at,
      disclosedTitle: r.disclosed_title,
      disclosedSummary: r.disclosed_summary,
      disclosedReportYaml: r.disclosed_report_yaml ?? null,
    });
  }
  return map;
}

export async function deleteAllForProject(
  projectId: string,
  sql: SqlLike = getDb(),
): Promise<number> {
  const rows = await sql`
    DELETE FROM findings
    WHERE project_id = ${projectId}::uuid
    RETURNING id::text
  `;
  return rows.length;
}

export async function upsertEncryptedFinding(
  input: {
    id: string;
    projectId: string;
    scanJobId: string;
    findingKey: string;
    severity: string;
    cwe: string | null;
    /** @deprecated dual-write; prefer title/detailJson */
    encPayload?: string | null;
    title?: string | null;
    primaryFile?: string | null;
    detailJson?: unknown;
    disclosureState?: DisclosureState;
    disclosedAt?: Date | null;
    disclosedTitle?: string | null;
    disclosedSummary?: string | null;
    disclosedReportYaml?: string | null;
    cvssScore?: number | null;
    cvssVector?: string | null;
    pocStatus?: string | null;
    itemType?: string;
    vhSeverity?: string | null;
  },
  sql: SqlLike = getDb(),
): Promise<void> {
  const disclosureState = input.disclosureState ?? "owner_only";
  const detailJson =
    input.detailJson === undefined ? null : JSON.stringify(input.detailJson);
  await sql`
    INSERT INTO findings (
      id, project_id, scan_job_id, finding_key, severity, cwe,
      enc_payload, title, primary_file, detail_json,
      disclosure_state, disclosed_at,
      disclosed_title, disclosed_summary, disclosed_report_yaml,
      cvss_score, cvss_vector, poc_status, item_type, vh_severity
    ) VALUES (
      ${input.id}::uuid,
      ${input.projectId}::uuid,
      ${input.scanJobId}::uuid,
      ${input.findingKey},
      ${input.severity},
      ${input.cwe},
      ${input.encPayload ?? ""},
      ${input.title ?? null},
      ${input.primaryFile ?? null},
      ${detailJson}::jsonb,
      ${disclosureState},
      ${input.disclosedAt ?? null},
      ${input.disclosedTitle ?? null},
      ${input.disclosedSummary ?? null},
      ${input.disclosedReportYaml ?? null},
      ${input.cvssScore ?? null},
      ${input.cvssVector ?? null},
      ${input.pocStatus ?? null},
      ${input.itemType ?? "finding"},
      ${input.vhSeverity ?? null}
    )
    ON CONFLICT (scan_job_id, finding_key) DO UPDATE SET
      severity = EXCLUDED.severity,
      cwe = EXCLUDED.cwe,
      enc_payload = EXCLUDED.enc_payload,
      title = EXCLUDED.title,
      primary_file = EXCLUDED.primary_file,
      detail_json = EXCLUDED.detail_json,
      cvss_score = EXCLUDED.cvss_score,
      cvss_vector = EXCLUDED.cvss_vector,
      poc_status = EXCLUDED.poc_status,
      item_type = EXCLUDED.item_type,
      vh_severity = EXCLUDED.vh_severity
  `;
}

export async function severityCounts(projectId: string): Promise<SeverityCounts> {
  const db = getDb();
  const rows = await db`
    SELECT f.severity, count(*)::text AS n
    FROM findings f
    JOIN projects p ON p.id = f.project_id AND p.current_scan_job_id = f.scan_job_id
    WHERE f.project_id = ${projectId}::uuid
      AND f.severity IN ('critical', 'high', 'medium', 'low')
    GROUP BY f.severity
  `;
  const out = emptySeverityCounts();
  for (const r of rows) {
    if (isPublicSeverity(r.severity)) out[r.severity] = Number(r.n);
  }
  return out;
}

export async function severityCountsMany(
  projectIds: string[],
): Promise<Map<string, SeverityCounts>> {
  const map = new Map<string, SeverityCounts>();
  for (const id of projectIds) map.set(id, emptySeverityCounts());
  if (projectIds.length === 0) return map;
  const db = getDb();
  const rows = await db`
    SELECT f.project_id::text, f.severity, count(*)::text AS n
    FROM findings f
    JOIN projects p ON p.id = f.project_id AND p.current_scan_job_id = f.scan_job_id
    WHERE f.project_id = ANY (${projectIds}::uuid[])
      AND f.severity IN ('critical', 'high', 'medium', 'low')
    GROUP BY f.project_id, f.severity
  `;
  for (const r of rows) {
    const cur = map.get(r.project_id) ?? emptySeverityCounts();
    if (isPublicSeverity(r.severity)) cur[r.severity] = Number(r.n);
    map.set(r.project_id, cur);
  }
  return map;
}

export async function cweDistribution(
  projectId: string,
): Promise<Array<{ cwe: string; count: number }>> {
  const db = getDb();
  const rows = await db`
    SELECT COALESCE(f.cwe, 'unknown') AS cwe, count(*)::text AS n
    FROM findings f
    JOIN projects p ON p.id = f.project_id AND p.current_scan_job_id = f.scan_job_id
    WHERE f.project_id = ${projectId}::uuid
      AND f.severity IN ('critical', 'high', 'medium', 'low')
    GROUP BY COALESCE(f.cwe, 'unknown')
    ORDER BY count(*) DESC
    LIMIT 20
  `;
  return (rows as unknown as Array<{ cwe: string; n: string }>).map((r) => ({
    cwe: r.cwe,
    count: Number(r.n),
  }));
}

export async function listDisclosedSummaries(projectId: string): Promise<
  Array<{
    id: string;
    finding_key: string;
    severity: Severity;
    title: string;
    cwe: string | null;
    disclosed_at: Date | null;
    summary: string | null;
    report_yaml: string | null;
  }>
> {
  const db = getDb();
  const rows = await db`
    SELECT f.id::text, f.finding_key, f.severity,
           COALESCE(f.disclosed_title, f.title) AS title,
           f.cwe, f.disclosed_at,
           f.disclosed_summary, f.disclosed_report_yaml,
           f.detail_json, f.primary_file
    FROM findings f
    JOIN projects p ON p.id = f.project_id AND p.current_scan_job_id = f.scan_job_id
    WHERE f.project_id = ${projectId}::uuid
      AND f.disclosure_state = 'disclosed'
      AND f.severity IN ('critical', 'high', 'medium', 'low')
    ORDER BY
      CASE f.severity
        WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3
        ELSE 4
      END,
      f.disclosed_at DESC NULLS LAST
  `;
  type DiscRow = {
    id: string;
    finding_key: string;
    severity: string;
    title: string | null;
    cwe: string | null;
    disclosed_at: Date | null;
    disclosed_summary: string | null;
    disclosed_report_yaml: string | null;
    detail_json: unknown;
    primary_file: string | null;
  };
  return (rows as unknown as DiscRow[])
    .filter((r) => isPublicSeverity(r.severity))
    .map((r) => ({
      id: r.id,
      finding_key: r.finding_key,
      severity: r.severity as Severity,
      title: r.title ?? r.finding_key,
      cwe: r.cwe,
      disclosed_at: r.disclosed_at,
      summary: r.disclosed_summary,
      report_yaml: r.disclosed_report_yaml,
      detail_json: r.detail_json ?? null,
      primary_file: r.primary_file,
    }));
}

/** Owner view: all findings on current scan (including owner_only). */
export async function listAllForOwner(projectId: string): Promise<
  Array<{
    id: string;
    finding_key: string;
    severity: Severity;
    title: string;
    cwe: string | null;
    primary_file: string | null;
    disclosure_state: DisclosureState;
    detail_json: unknown;
    report_yaml: string | null;
    cvss_score: number | null;
    poc_status: string | null;
  }>
> {
  const db = getDb();
  const rows = await db`
    SELECT f.id::text, f.finding_key, f.severity, COALESCE(f.title, f.disclosed_title, f.finding_key) AS title,
           f.cwe, f.primary_file, f.disclosure_state, f.detail_json,
           f.disclosed_report_yaml, f.cvss_score, f.poc_status
    FROM findings f
    JOIN projects p ON p.id = f.project_id AND p.current_scan_job_id = f.scan_job_id
    WHERE f.project_id = ${projectId}::uuid
      AND f.severity IN ('critical', 'high', 'medium', 'low')
    ORDER BY
      CASE f.severity
        WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4
      END,
      f.finding_key
  `;
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    finding_key: String(r.finding_key),
    severity: r.severity as Severity,
    title: String(r.title ?? r.finding_key),
    cwe: (r.cwe as string) ?? null,
    primary_file: (r.primary_file as string) ?? null,
    disclosure_state: r.disclosure_state as DisclosureState,
    detail_json: r.detail_json ?? null,
    report_yaml: (r.disclosed_report_yaml as string) ?? null,
    cvss_score: r.cvss_score != null ? Number(r.cvss_score) : null,
    poc_status: (r.poc_status as string) ?? null,
  }));
}

export async function ownerDiscloseFindings(
  projectId: string,
  findingIds: string[],
): Promise<number> {
  if (findingIds.length === 0) return 0;
  const db = getDb();
  const rows = await db`
    UPDATE findings f
    SET disclosure_state = 'disclosed',
        disclosed_at = COALESCE(f.disclosed_at, now()),
        disclosed_title = COALESCE(f.disclosed_title, f.title, f.finding_key),
        disclosed_report_yaml = COALESCE(
          f.disclosed_report_yaml,
          f.detail_json->>'report_yaml',
          f.detail_json->'detail'->>'report_yaml'
        )
    FROM projects p
    WHERE f.project_id = p.id
      AND p.id = ${projectId}::uuid
      AND p.current_scan_job_id = f.scan_job_id
      AND f.id = ANY(${findingIds}::uuid[])
      AND f.disclosure_state = 'owner_only'
    RETURNING f.id
  `;
  return rows.length;
}

export async function platformSeverityCounts(): Promise<SeverityCounts> {
  const db = getDb();
  const rows = await db`
    SELECT f.severity, count(*)::text AS n
    FROM findings f
    JOIN projects p ON p.id = f.project_id
      AND p.removed_at IS NULL
      AND p.current_scan_job_id = f.scan_job_id
    WHERE f.severity IN ('critical', 'high', 'medium', 'low')
    GROUP BY f.severity
  `;
  const out = emptySeverityCounts();
  for (const r of rows) {
    if (isPublicSeverity(r.severity)) out[r.severity] = Number(r.n);
  }
  return out;
}

export async function platformFindingTotals(): Promise<{ total: number; disclosed: number }> {
  const db = getDb();
  const rows = await db`
    SELECT
      count(*) FILTER (
        WHERE f.severity IN ('critical', 'high', 'medium', 'low')
      )::text AS total,
      count(*) FILTER (
        WHERE f.disclosure_state = 'disclosed'
          AND f.severity IN ('critical', 'high', 'medium', 'low')
      )::text AS disclosed
    FROM findings f
    JOIN projects p ON p.id = f.project_id
      AND p.removed_at IS NULL
      AND p.current_scan_job_id = f.scan_job_id
  `;
  return {
    total: Number(rows[0]?.total ?? 0),
    disclosed: Number(rows[0]?.disclosed ?? 0),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function countPublicForScanJob(scanJobId: string): Promise<number> {
  const db = getDb();
  const rows = await db`
    SELECT count(*)::text AS n FROM findings
    WHERE scan_job_id = ${scanJobId}::uuid
      AND severity IN ('critical', 'high', 'medium', 'low')
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function listEncryptedPackage(projectId: string): Promise<
  Array<{
    finding_id: string;
    finding_key: string;
    severity: string;
    cwe: string | null;
    disclosure_state: DisclosureState;
    enc_payload: string;
    disclosed_title: string | null;
    disclosed_summary: string | null;
  }>
> {
  const db = getDb();
  return db`
    SELECT
      f.id::text AS finding_id,
      f.finding_key,
      f.severity,
      f.cwe,
      f.disclosure_state,
      f.enc_payload,
      f.disclosed_title,
      f.disclosed_summary
    FROM findings f
    JOIN projects p ON p.id = f.project_id
    WHERE f.project_id = ${projectId}::uuid
      AND f.severity IN ('critical', 'high', 'medium', 'low')
      AND (p.current_scan_job_id IS NULL OR f.scan_job_id = p.current_scan_job_id)
    ORDER BY
      CASE f.severity
        WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3
        ELSE 4
      END,
      f.finding_key ASC
  `;
}

export async function applyDisclose(
  projectId: string,
  items: Array<{
    finding_id: string;
    title: string;
    cwe?: string | null;
    summary?: string | null;
    report_yaml?: string | null;
    files?: Array<{
      kind: string;
      rel_path: string;
      file_name: string;
      content: string;
    }>;
  }>,
): Promise<string[]> {
  if (items.length === 0) return [];
  const db = getDb();
  const updated: string[] = [];
  for (const it of items) {
    if (!isUuid(it.finding_id)) continue;
    const rows = await db.begin(async (tx) => {
      const up = await tx<{ id: string }[]>`
        UPDATE findings
        SET
          disclosure_state = 'disclosed',
          disclosed_at = now(),
          disclosed_title = ${it.title},
          disclosed_summary = ${it.summary ?? null},
          cwe = COALESCE(${it.cwe ?? null}, cwe),
          disclosed_report_yaml = COALESCE(${it.report_yaml ?? null}, disclosed_report_yaml)
        WHERE id = ${it.finding_id}::uuid
          AND project_id = ${projectId}::uuid
          AND severity IN ('critical', 'high', 'medium', 'low')
        RETURNING id::text
      `;
      if (!up[0]) return [] as { id: string }[];

      // Replace disclosed files for this finding (idempotent re-disclose)
      await tx`DELETE FROM disclosed_files WHERE finding_id = ${it.finding_id}::uuid`;

      if (it.report_yaml) {
        await tx`
          INSERT INTO disclosed_files (finding_id, project_id, kind, rel_path, file_name, content)
          VALUES (
            ${it.finding_id}::uuid,
            ${projectId}::uuid,
            'report',
            'report.yaml',
            'report.yaml',
            ${it.report_yaml}
          )
          ON CONFLICT (finding_id, rel_path) DO UPDATE SET content = EXCLUDED.content
        `;
      }

      for (const f of it.files ?? []) {
        if (!f?.rel_path || typeof f.content !== "string") continue;
        const kind = ["poc", "exp", "report", "other"].includes(f.kind) ? f.kind : "other";
        const fileName = f.file_name || f.rel_path.split("/").pop() || "file";
        await tx`
          INSERT INTO disclosed_files (finding_id, project_id, kind, rel_path, file_name, content)
          VALUES (
            ${it.finding_id}::uuid,
            ${projectId}::uuid,
            ${kind},
            ${f.rel_path},
            ${fileName},
            ${f.content}
          )
          ON CONFLICT (finding_id, rel_path) DO UPDATE SET content = EXCLUDED.content
        `;
      }
      return up;
    });
    if (rows[0]) updated.push(rows[0].id);
  }
  return updated;
}

/** Public: files for a disclosed finding only. */
export async function listDisclosedFilesForFinding(
  projectId: string,
  findingKey: string,
): Promise<
  Array<{ kind: string; rel_path: string; file_name: string; content: string; finding_key: string }>
> {
  const db = getDb();
  return db`
    SELECT df.kind, df.rel_path, df.file_name, df.content, f.finding_key
    FROM disclosed_files df
    JOIN findings f ON f.id = df.finding_id
    JOIN projects p ON p.id = f.project_id AND p.current_scan_job_id = f.scan_job_id
    WHERE f.project_id = ${projectId}::uuid
      AND f.finding_key = ${findingKey}
      AND f.disclosure_state = 'disclosed'
    ORDER BY df.kind, df.rel_path
  `;
}

export async function listDisclosedFilesForProject(
  projectId: string,
): Promise<
  Array<{ kind: string; rel_path: string; file_name: string; content: string; finding_key: string }>
> {
  const db = getDb();
  return db`
    SELECT df.kind, df.rel_path, df.file_name, df.content, f.finding_key
    FROM disclosed_files df
    JOIN findings f ON f.id = df.finding_id
    JOIN projects p ON p.id = f.project_id AND p.current_scan_job_id = f.scan_job_id
    WHERE f.project_id = ${projectId}::uuid
      AND f.disclosure_state = 'disclosed'
    ORDER BY f.finding_key, df.kind, df.rel_path
  `;
}

export async function getDisclosedReportYaml(
  projectId: string,
  findingKey: string,
): Promise<string | null> {
  const db = getDb();
  const rows = await db<{ yaml: string | null }[]>`
    SELECT f.disclosed_report_yaml AS yaml
    FROM findings f
    JOIN projects p ON p.id = f.project_id AND p.current_scan_job_id = f.scan_job_id
    WHERE f.project_id = ${projectId}::uuid
      AND f.finding_key = ${findingKey}
      AND f.disclosure_state = 'disclosed'
  `;
  return rows[0]?.yaml ?? null;
}

export async function consumeNonce(nonce: string): Promise<boolean> {
  const db = getDb();
  try {
    await db`INSERT INTO admin_nonces (nonce) VALUES (${nonce})`;
  } catch {
    return false;
  }
  await db`DELETE FROM admin_nonces WHERE used_at < now() - interval '1 hour'`;
  return true;
}
