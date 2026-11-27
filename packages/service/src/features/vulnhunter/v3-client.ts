/**
 * VulnHunter 3.0 HTTP client implementing the OpenVuln VulnHunterClient interface.
 *
 * Authentication: personal API token via `Authorization: Bearer vht_...` (no cookies).
 * Lifecycle:
 *   - createScanTask / createScanTaskFromArchive: creates a 3.0 project (git or archive),
 *     then starts a `code-audit` task referencing that project. If task creation fails,
 *     the temporary project is deleted best-effort.
 *   - getTask: maps 3.0 statuses (`starting|running|paused|succeeded|failed|stopped|interrupted`)
 *     to OpenVuln's VhTaskState, and maps 3.0 RFC-7807 `code: "not_found"` 404 to VhTaskGoneError.
 *   - listFindings / getFindingDetail / listFindingArtifacts / getArtifactFilePreview:
 *     reads `/api/tasks/:id/results`, `/api/tasks/:id/tree`, and `/api/tasks/:id/file?p=output/...`.
 *     When OpenVuln requests `findings/<key>/report.yaml` and 3.0 has only `record.json`,
 *     synthesizes a parseReportYaml-compatible YAML document from `record.json`.
 *   - deleteTask: stops active task if needed, deletes the task, then deletes the
 *     linked scan project best-effort so temporary projects do not accumulate.
 */
import * as yaml from "js-yaml";
import {
  type CreateScanTaskFromArchiveInput,
  type CreateScanTaskInput,
  type CreateScanTaskOptions,
  type VhArtifactFileEntry,
  type VhArtifactFilePreview,
  type VhFindingArtifactGroups,
  type VhFindingMeta,
  type VhTaskState,
  VhTaskGoneError,
  type VulnHunterClient,
} from "./client.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 300_000;
const MAX_PROJECT_NAME_LEN = 120;
const MAX_VULN_FOCUS_LEN = 500;
const V3_ACTIVE_STATUSES = new Set(["starting", "running", "paused"]);

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
const BINARY_EXTS = new Set([
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".pdf", ".wasm",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".class", ".jar", ".pyc", ".o", ".a",
]);

export interface V3ModelSelection {
  providerId: string;
  modelId: string;
}

export interface V3VulnHunterClientOpts {
  baseUrl: string;
  apiToken: string;
  /** Optional explicit model selection for POST /api/tasks (when omitted, 3.0 uses user default). */
  model?: V3ModelSelection;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
  /** Optional custom fetch implementation (used in tests). */
  fetchImpl?: typeof fetch;
}

interface V3TaskView {
  id: string;
  status: string;
  source?: { project?: string; kind?: string } | null;
  error?: { code?: string; message?: string } | null;
  stages?: unknown[];
}

interface V3ResultView {
  kind: string;
  key: string;
  title: string;
  severity?: string | null;
  summary?: string;
  path?: string;
  data?: Record<string, unknown>;
}

interface V3TreeEntry {
  path: string;
  type: "file" | "dir";
  size?: number;
}

type V3WorkspaceFile =
  | { path: string; content: string; size: number; mtime?: string }
  | { path: string; binary: true; size: number };

function isV3NotFoundBody(status: number, bodyText: string): boolean {
  if (status !== 404) return false;
  try {
    const parsed = JSON.parse(bodyText) as { code?: string; error?: { code?: string } };
    return (
      parsed?.code === "not_found" ||
      parsed?.error?.code === "not_found" ||
      parsed?.error?.code === "ERR_TASK_NOT_FOUND"
    );
  } catch {
    return false;
  }
}

function mapV3Status(status: string): VhTaskState {
  switch (status) {
    case "starting":
      return "preparing";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "succeeded":
      return "completed";
    case "failed":
    case "interrupted":
      return "failed";
    case "stopped":
      return "cancelled";
    default:
      return status;
  }
}

function inferArtifactKind(filePath: string): "text" | "image" | "binary" {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return "text";
  const ext = filePath.slice(dot).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (BINARY_EXTS.has(ext)) return "binary";
  return "text";
}

function primaryFileFromLocation(loc: unknown): string | null {
  if (typeof loc !== "string") return null;
  const trimmed = loc.trim();
  if (!trimmed) return null;
  // Format is typically "src/app.py:42-48" or "src/app.py"
  const colonIdx = trimmed.indexOf(":");
  return colonIdx > 0 ? trimmed.slice(0, colonIdx) : trimmed;
}

function extractPrimaryFileFromRecord(record: Record<string, unknown>): string | null {
  if (typeof record.primary_file === "string" && record.primary_file.trim()) {
    return record.primary_file.trim();
  }
  if (typeof record.file === "string" && record.file.trim()) {
    return record.file.trim();
  }
  if (typeof record.location === "string") {
    return primaryFileFromLocation(record.location);
  }
  if (Array.isArray(record.locations) && record.locations.length > 0) {
    return primaryFileFromLocation(record.locations[0]);
  }
  if (Array.isArray(record.dataflow)) {
    for (const step of record.dataflow) {
      if (step && typeof step === "object") {
        const loc = (step as Record<string, unknown>).location;
        const f = primaryFileFromLocation(loc);
        if (f) return f;
      }
    }
  }
  return null;
}

function normalizeV3FilePath(relPath: string): string {
  const clean = relPath.replace(/^\/+/, "");
  if (clean.startsWith("output/") || clean.startsWith("project/")) {
    return clean;
  }
  return `output/${clean}`;
}

function strOrUndefined(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

/**
 * Converts a VulnHunter 3.0 `findings/<key>/record.json` object into a YAML report
 * conforming to OpenVuln's `parseReportYaml` schema (`metadata`, `description`, `code`, `references`).
 */
export function recordJsonToReportYaml(
  record: Record<string, unknown>,
  findingKey?: string,
): string {
  const metadata: Record<string, unknown> = {};
  const setMeta = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") metadata[k] = v;
  };
  setMeta("title", strOrUndefined(record.title) ?? findingKey);
  setMeta("cwe", strOrUndefined(record.cwe));
  setMeta("vuln_type", strOrUndefined(record.vuln_type));
  setMeta("severity", strOrUndefined(record.severity));
  if (typeof record.cvss_score === "number" && Number.isFinite(record.cvss_score)) {
    metadata.cvss_score = record.cvss_score;
  }
  setMeta("cvss_vector", strOrUndefined(record.cvss_vector));
  setMeta("ev_priority", strOrUndefined(record.ev_priority));
  if (typeof record.ev_score === "number" && Number.isFinite(record.ev_score)) {
    metadata.ev_score = record.ev_score;
  }
  setMeta("ev_rationale", strOrUndefined(record.ev_rationale));
  setMeta("poc_status", strOrUndefined(record.poc_status));
  setMeta("exp_status", strOrUndefined(record.exp_status));
  setMeta("affected_versions", strOrUndefined(record.affected_versions));

  const primaryFile = extractPrimaryFileFromRecord(record);
  if (primaryFile) {
    metadata.anchors = [
      {
        file_path: primaryFile,
        ...(record.line != null ? { line: record.line } : {}),
        ...(typeof record.function === "string" ? { function: record.function } : {}),
      },
    ];
  }

  const description: Record<string, unknown> = {};
  const setDesc = (k: string, v: unknown) => {
    const s = strOrUndefined(v);
    if (s) description[k] = s;
  };
  setDesc("background", record.background);
  setDesc("summary", record.summary);
  setDesc("detailed_description", record.detailed_description ?? record.description);
  setDesc("attack_description", record.attack_description ?? record.reproduction);
  setDesc("impact", record.impact);
  setDesc("remediation", record.remediation ?? record.fix ?? record.recommendation);
  setDesc("evidence_limits", record.evidence_limits);
  setDesc("poc_evidence", record.poc_evidence);

  const code: Record<string, unknown> = {};
  if (Array.isArray(record.dataflow) && record.dataflow.length > 0) {
    code.dataflow = record.dataflow;
  }
  const fixPatch = strOrUndefined(record.fix_patch);
  if (fixPatch) code.fix_patch = fixPatch;

  const doc: Record<string, unknown> = { metadata, description };
  if (Object.keys(code).length > 0) doc.code = code;
  if (record.references !== undefined && record.references !== null) {
    doc.references = record.references;
  }

  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}

export class V3VulnHunterClient implements VulnHunterClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly model?: V3ModelSelection;
  private readonly timeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: V3VulnHunterClientOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiToken = opts.apiToken;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.uploadTimeoutMs = opts.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
    this.fetchFn = opts.fetchImpl ?? fetch;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: "application/json",
      ...extra,
    };
  }

  private async request(
    method: string,
    path: string,
    opts?: { body?: unknown; form?: FormData; timeoutMs?: number },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = opts?.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = opts?.form
        ? this.authHeaders()
        : opts?.body !== undefined
          ? this.authHeaders({ "Content-Type": "application/json" })
          : this.authHeaders();
      return await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts?.form ?? (opts?.body !== undefined ? JSON.stringify(opts.body) : undefined),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readErrorText(res: Response): Promise<string> {
    return (await res.text().catch(() => "")).slice(0, 500);
  }

  private async deleteProjectBestEffort(projectId: string): Promise<void> {
    try {
      await this.request("DELETE", `/api/projects/${encodeURIComponent(projectId)}`);
    } catch {
      // Best-effort cleanup only; ignore network/409/404 errors.
    }
  }

  private buildTaskParams(opts: CreateScanTaskOptions): Record<string, unknown> {
    const mode = opts.enableDynamicVerify || opts.enableDynamicExploit ? "dynamic" : "static";
    const outputLang = opts.outputLanguage === "zh-CN" || opts.outputLanguage === "en"
      ? opts.outputLanguage
      : "en";
    const params: Record<string, unknown> = {
      mode,
      output_lang: outputLang,
      skills: [],
      mcps: [],
    };
    const focusRaw = opts.vulnFocus?.trim() || opts.auditFocus?.trim();
    if (focusRaw) {
      params.vuln_focus = focusRaw.slice(0, MAX_VULN_FOCUS_LEN);
    }
    return params;
  }

  private async createTaskForProject(
    projectId: string,
    displayName: string,
    opts: CreateScanTaskOptions,
  ): Promise<{ taskId: string }> {
    const body: Record<string, unknown> = {
      type: "code-audit",
      name: displayName.slice(0, MAX_PROJECT_NAME_LEN),
      params: this.buildTaskParams(opts),
      source: { project: projectId },
    };
    if (this.model) {
      body.model = this.model;
    }

    const res = await this.request("POST", "/api/tasks", { body });
    if (!res.ok) {
      const text = await this.readErrorText(res);
      await this.deleteProjectBestEffort(projectId);
      throw new Error(`VH3 createTask failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { task?: { id?: string } };
    const taskId = data.task?.id;
    if (!taskId) {
      await this.deleteProjectBestEffort(projectId);
      throw new Error("VH3 createTask response missing task.id");
    }
    return { taskId };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.request("GET", "/api/healthz", { timeoutMs: 10_000 });
      return res.ok;
    } catch {
      return false;
    }
  }

  async createScanTask(input: CreateScanTaskInput): Promise<{ taskId: string }> {
    const projectRes = await this.request("POST", "/api/projects", {
      body: {
        kind: "git",
        url: input.gitUrl,
        name: input.displayName.slice(0, MAX_PROJECT_NAME_LEN),
      },
    });
    if (!projectRes.ok) {
      throw new Error(`VH3 createProject(git) failed: ${projectRes.status} ${await this.readErrorText(projectRes)}`);
    }
    const projectData = (await projectRes.json()) as { project?: { id?: string } };
    const projectId = projectData.project?.id;
    if (!projectId) {
      throw new Error("VH3 createProject(git) response missing project.id");
    }
    return this.createTaskForProject(projectId, input.displayName, input);
  }

  async createScanTaskFromArchive(input: CreateScanTaskFromArchiveInput): Promise<{ taskId: string }> {
    const form = new FormData();
    // 3.0 multipart contract requires `spec` JSON field BEFORE the `archive` file stream.
    form.append(
      "spec",
      JSON.stringify({
        kind: "archive",
        name: input.displayName.slice(0, MAX_PROJECT_NAME_LEN),
      }),
    );
    const blob = new Blob([new Uint8Array(input.archive)], { type: "application/zip" });
    form.append("archive", blob, input.filename);

    const uploadRes = await this.request("POST", "/api/projects/upload", {
      form,
      timeoutMs: this.uploadTimeoutMs,
    });
    if (!uploadRes.ok) {
      throw new Error(
        `VH3 createProject(archive) failed: ${uploadRes.status} ${await this.readErrorText(uploadRes)}`,
      );
    }
    const projectData = (await uploadRes.json()) as { project?: { id?: string } };
    const projectId = projectData.project?.id;
    if (!projectId) {
      throw new Error("VH3 createProject(archive) response missing project.id");
    }
    return this.createTaskForProject(projectId, input.displayName, input);
  }

  async getTask(taskId: string): Promise<{
    state: VhTaskState;
    failureReason?: string | null;
    metadata?: Record<string, unknown> | null;
  }> {
    const res = await this.request("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
    if (!res.ok) {
      const text = await this.readErrorText(res);
      if (isV3NotFoundBody(res.status, text)) {
        throw new VhTaskGoneError(taskId);
      }
      throw new Error(`VH3 getTask failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { task?: V3TaskView };
    const task = data.task;
    if (!task) {
      throw new Error("VH3 getTask response missing task");
    }
    return {
      state: mapV3Status(task.status),
      failureReason: task.error?.message ?? null,
      metadata: {
        source: task.source ?? null,
        stages: task.stages ?? [],
        error: task.error ?? null,
      },
    };
  }

  async listFindings(taskId: string): Promise<VhFindingMeta[]> {
    const res = await this.request("GET", `/api/tasks/${encodeURIComponent(taskId)}/results`);
    if (!res.ok) {
      throw new Error(`VH3 listFindings failed: ${res.status} ${await this.readErrorText(res)}`);
    }
    const data = (await res.json()) as { results?: V3ResultView[] };
    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .filter((r) => r.kind === "finding")
      .map((r) => {
        const d = (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>;
        const locations = Array.isArray(d.locations) ? d.locations : [];
        const primaryFile = locations.length > 0 ? primaryFileFromLocation(locations[0]) : null;
        return {
          key: r.key,
          title: r.title,
          severity: r.severity ?? undefined,
          cwe: typeof d.cwe === "string" ? d.cwe : null,
          primary_file: primaryFile,
          item_type: "finding",
          poc_status: typeof d.poc_status === "string" ? d.poc_status : null,
          cvss_score: typeof d.cvss_score === "number" ? d.cvss_score : null,
          cvss_vector: typeof d.cvss_vector === "string" ? d.cvss_vector : null,
          vuln_type: d.vuln_type,
          ev_score: d.ev_score,
          ev_priority: d.ev_priority,
          exp_status: d.exp_status,
          summary: r.summary,
        };
      });
  }

  private async readTaskFile(taskId: string, v3Path: string): Promise<V3WorkspaceFile | null> {
    const res = await this.request(
      "GET",
      `/api/tasks/${encodeURIComponent(taskId)}/file?p=${encodeURIComponent(v3Path)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`VH3 readTaskFile(${v3Path}) failed: ${res.status} ${await this.readErrorText(res)}`);
    }
    return (await res.json()) as V3WorkspaceFile;
  }

  async getFindingDetail(taskId: string, key: string): Promise<unknown> {
    const file = await this.readTaskFile(taskId, `output/findings/${key}/record.json`);
    if (!file || "binary" in file) return null;
    try {
      const parsed = JSON.parse(file.content) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const primaryFile = extractPrimaryFileFromRecord(parsed);
        if (primaryFile && !parsed.primary_file) {
          return { ...parsed, primary_file: primaryFile };
        }
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async listFindingArtifacts(taskId: string, findingId: string): Promise<VhFindingArtifactGroups> {
    const res = await this.request("GET", `/api/tasks/${encodeURIComponent(taskId)}/tree`);
    if (res.status === 404) {
      return { poc: { files: [] }, exp: { files: [] } };
    }
    if (!res.ok) {
      throw new Error(`VH3 listFindingArtifacts failed: ${res.status} ${await this.readErrorText(res)}`);
    }
    const data = (await res.json()) as { entries?: V3TreeEntry[] };
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const basePrefix = `output/findings/${findingId}/`;
    const poc: VhArtifactFileEntry[] = [];
    const exp: VhArtifactFileEntry[] = [];

    for (const entry of entries) {
      if (entry.type !== "file" || !entry.path.startsWith(basePrefix)) continue;
      const rel = entry.path.slice(basePrefix.length);
      const kind = inferArtifactKind(rel);
      const item: VhArtifactFileEntry = {
        path: rel,
        size: entry.size ?? 0,
        kind,
        previewable: kind === "text",
      };
      if (rel.startsWith("poc/")) poc.push(item);
      else if (rel.startsWith("exp/")) exp.push(item);
    }

    return { poc: { files: poc }, exp: { files: exp } };
  }

  async getArtifactFilePreview(
    taskId: string,
    relPath: string,
  ): Promise<VhArtifactFilePreview | null> {
    const v3Path = normalizeV3FilePath(relPath);
    const file = await this.readTaskFile(taskId, v3Path);
    if (!file) {
      // Compatibility bridge: 3.0 emits `record.json` (+ `report.md`) instead of 2.x `report.yaml`.
      const reportMatch = relPath.replace(/^\/+/, "").match(/^(?:output\/)?findings\/([^/]+)\/report\.yaml$/);
      if (reportMatch) {
        const findingKey = reportMatch[1];
        const detail = await this.getFindingDetail(taskId, findingKey);
        if (detail && typeof detail === "object" && !Array.isArray(detail)) {
          const content = recordJsonToReportYaml(detail as Record<string, unknown>, findingKey);
          return {
            kind: "text",
            size: Buffer.byteLength(content, "utf8"),
            language: "yaml",
            content,
            truncated: false,
            mime: "application/yaml",
          };
        }
      }
      return null;
    }

    if ("binary" in file && file.binary) {
      return {
        kind: inferArtifactKind(relPath) === "image" ? "image" : "binary",
        size: file.size,
        truncated: false,
      };
    }

    const content = "content" in file ? file.content : "";
    const byteLen = Buffer.byteLength(content, "utf8");
    return {
      kind: "text",
      size: file.size ?? byteLen,
      content,
      truncated: (file.size ?? byteLen) > byteLen,
    };
  }

  async deleteTask(taskId: string): Promise<void> {
    let projectId: string | null = null;
    let status: string | null = null;

    const getRes = await this.request("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
    if (getRes.status === 404) {
      return;
    }
    if (getRes.ok) {
      const data = (await getRes.json()) as { task?: V3TaskView };
      status = data.task?.status ?? null;
      projectId = data.task?.source?.project ?? null;
    }

    if (status && V3_ACTIVE_STATUSES.has(status)) {
      const stopRes = await this.request("POST", `/api/tasks/${encodeURIComponent(taskId)}/stop`);
      // 409 means the task finished between GET and POST /stop — safe to proceed with DELETE.
      if (!stopRes.ok && stopRes.status !== 404 && stopRes.status !== 409) {
        throw new Error(`VH3 stopTask failed: ${stopRes.status} ${await this.readErrorText(stopRes)}`);
      }
    }

    const delRes = await this.request("DELETE", `/api/tasks/${encodeURIComponent(taskId)}`);
    if (!delRes.ok && delRes.status !== 404) {
      throw new Error(`VH3 deleteTask failed: ${delRes.status} ${await this.readErrorText(delRes)}`);
    }

    if (projectId) {
      await this.deleteProjectBestEffort(projectId);
    }
  }
}
