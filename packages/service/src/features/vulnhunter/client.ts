/** VulnHunter client interface — switch point for cookie/token. */

export type VhTaskState =
  | "queued"
  | "preparing"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused"
  /** Non-enum VH state — poller applies grace then fails. */
  | (string & {});

/**
 * VH confirmed the task is gone (HTTP 404 + ERR_TASK_NOT_FOUND).
 * Structured body proves API is reachable — distinct from network/5xx outages.
 */
export class VhTaskGoneError extends Error {
  readonly code = "VH_TASK_GONE" as const;
  constructor(public readonly taskId: string) {
    super(`VH task gone: ${taskId}`);
    this.name = "VhTaskGoneError";
  }
}

export function isVhTaskGoneError(err: unknown): err is VhTaskGoneError {
  return err instanceof VhTaskGoneError;
}

/** True when 404 body is the VH structured not-found (not nginx bare 404). */
export function isVhTaskNotFoundBody(status: number, bodyText: string): boolean {
  if (status !== 404) return false;
  try {
    const data = JSON.parse(bodyText) as { error?: { code?: string } };
    return data?.error?.code === "ERR_TASK_NOT_FOUND";
  } catch {
    return false;
  }
}

export interface VhFindingMeta {
  key: string;
  severity?: string;
  title?: string;
  cwe?: string | null;
  primary_file?: string | null;
  item_type?: string;
  poc_status?: string | null;
  cvss_score?: number | null;
  cvss_vector?: string | null;
  [extra: string]: unknown;
}

/** Optional VH create-task knobs (OpenVuln defaults come from ServiceConfig). */
export interface CreateScanTaskOptions {
  /** Custom deadline in seconds (VH source_meta.scan_timeout). */
  scanTimeoutSeconds?: number;
  timeoutMode?: "custom" | "auto";
  maxItemsPerRecon?: number;
  agentMaxParallel?: number;
  auditFocus?: string;
  enableDynamicVerify?: boolean;
  enableDynamicExploit?: boolean;
}

export interface CreateScanTaskInput extends CreateScanTaskOptions {
  gitUrl: string;
  displayName: string;
  /** Optional VH LLM credential id when account has multiple / no default. */
  credentialId?: string;
}

/** Multipart upload create (OpenVuln-owned zipball). */
export interface CreateScanTaskFromArchiveInput extends CreateScanTaskOptions {
  displayName: string;
  /** Zip bytes */
  archive: Buffer;
  /** Filename with .zip extension (VH format detect). */
  filename: string;
  credentialId?: string;
}

/** One file under a finding's poc/ or exp/ card. */
export interface VhArtifactFileEntry {
  path: string;
  size: number;
  kind: "text" | "image" | "binary" | string;
  previewable?: boolean;
}

export interface VhFindingArtifactGroups {
  poc: { files: VhArtifactFileEntry[] };
  exp: { files: VhArtifactFileEntry[] };
}

export interface VhArtifactFilePreview {
  kind: "text" | "image" | "binary" | string;
  size: number;
  language?: string;
  content?: string;
  truncated: boolean;
  mime?: string;
  data_base64?: string;
}

export interface VulnHunterClient {
  createScanTask(input: CreateScanTaskInput): Promise<{ taskId: string }>;
  /** Preferred path: multipart source archive upload. */
  createScanTaskFromArchive(input: CreateScanTaskFromArchiveInput): Promise<{ taskId: string }>;
  getTask(taskId: string): Promise<{
    state: VhTaskState;
    /** VH failure_reason text when state=failed */
    failureReason?: string | null;
    /** VH task.metadata (may include source_incomplete / prepare.reason) */
    metadata?: Record<string, unknown> | null;
  }>;
  listFindings(taskId: string): Promise<VhFindingMeta[]>;
  getFindingDetail(taskId: string, key: string): Promise<unknown>;
  /** List poc/exp files for a finding (finding_key or VH id). */
  listFindingArtifacts(taskId: string, findingId: string): Promise<VhFindingArtifactGroups>;
  /** Preview one artifact; path is task-relative (findings/…/poc/…). */
  getArtifactFilePreview(taskId: string, relPath: string): Promise<VhArtifactFilePreview | null>;
  healthCheck(): Promise<boolean>;
  /** Delete/cancel a VH task. */
  deleteTask(taskId: string): Promise<void>;
}
