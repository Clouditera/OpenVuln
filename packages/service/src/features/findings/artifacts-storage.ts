import { getDb } from "../../infra/db/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlLike = any;

export interface ArtifactInsert {
  /** Pre-generated id — AAD for OVENC1 envelope. */
  id: string;
  findingId: string;
  projectId: string;
  scanJobId: string;
  kind: "poc" | "exp" | "other";
  relPath: string;
  fileName: string;
  mime: string | null;
  sizeBytes: number;
  /** OVENC1 ciphertext only — never plaintext. */
  encContent: string | null;
  truncated: boolean;
  isBinary: boolean;
}

/** Soft cap for stored UTF-8 text (task: >1MB truncated). */
export const ARTIFACT_CONTENT_MAX_CHARS = 1_000_000;

export async function deleteArtifactsForProject(
  projectId: string,
  sql: SqlLike = getDb(),
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM finding_artifacts
    WHERE project_id = ${projectId}::uuid
    RETURNING id::text
  `;
  return rows.length;
}

export async function insertArtifact(row: ArtifactInsert, sql: SqlLike = getDb()): Promise<void> {
  await sql`
    INSERT INTO finding_artifacts (
      id, finding_id, project_id, scan_job_id, kind, rel_path, file_name,
      mime, size_bytes, content, truncated, is_binary
    ) VALUES (
      ${row.id}::uuid,
      ${row.findingId}::uuid,
      ${row.projectId}::uuid,
      ${row.scanJobId}::uuid,
      ${row.kind},
      ${row.relPath},
      ${row.fileName},
      ${row.mime},
      ${row.sizeBytes},
      ${row.encContent},
      ${row.truncated},
      ${row.isBinary}
    )
    ON CONFLICT (finding_id, rel_path) DO UPDATE SET
      id = EXCLUDED.id,
      mime = EXCLUDED.mime,
      size_bytes = EXCLUDED.size_bytes,
      content = EXCLUDED.content,
      truncated = EXCLUDED.truncated,
      is_binary = EXCLUDED.is_binary
  `;
}

export async function countArtifactsForProject(projectId: string): Promise<number> {
  const db = getDb();
  const rows = await db<{ n: string }[]>`
    SELECT count(*)::text AS n FROM finding_artifacts
    WHERE project_id = ${projectId}::uuid
  `;
  return Number(rows[0]?.n ?? 0);
}

/** Metadata only — never returns ciphertext body on public paths. */
export async function listArtifactsForFinding(findingId: string): Promise<
  Array<{
    kind: string;
    rel_path: string;
    file_name: string;
    mime: string | null;
    size_bytes: number;
    truncated: boolean;
    is_binary: boolean;
    has_enc_content: boolean;
  }>
> {
  const db = getDb();
  return db`
    SELECT
      kind, rel_path, file_name, mime, size_bytes, truncated, is_binary,
      (content IS NOT NULL AND content LIKE 'OVENC1.%') AS has_enc_content
    FROM finding_artifacts
    WHERE finding_id = ${findingId}::uuid
    ORDER BY kind, rel_path
  `;
}

/** Admin report-package: ciphertext artifacts keyed by finding. */
export async function listEncryptedArtifactsForProject(projectId: string): Promise<
  Array<{
    artifact_id: string;
    finding_id: string;
    finding_key: string;
    kind: string;
    rel_path: string;
    file_name: string;
    mime: string | null;
    size_bytes: number;
    truncated: boolean;
    is_binary: boolean;
    enc_content: string | null;
  }>
> {
  const db = getDb();
  return db`
    SELECT
      a.id::text AS artifact_id,
      a.finding_id::text AS finding_id,
      f.finding_key,
      a.kind,
      a.rel_path,
      a.file_name,
      a.mime,
      a.size_bytes,
      a.truncated,
      a.is_binary,
      a.content AS enc_content
    FROM finding_artifacts a
    JOIN findings f ON f.id = a.finding_id
    JOIN projects p ON p.id = a.project_id
    WHERE a.project_id = ${projectId}::uuid
      AND (p.current_scan_job_id IS NULL OR f.scan_job_id = p.current_scan_job_id)
    ORDER BY f.finding_key, a.kind, a.rel_path
  `;
}
