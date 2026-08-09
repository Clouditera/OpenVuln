import { logger } from "../../infra/logger.js";
import {
  type CreateScanTaskFromArchiveInput,
  type CreateScanTaskInput,
  type VulnHunterClient,
  type VhFindingMeta,
  type VhTaskState,
  isVhTaskNotFoundBody,
  VhTaskGoneError,
} from "./client.js";

interface TokenClientOptions {
  baseUrl: string;
  apiToken: string;
  /** Default credential_id when createScanTask does not pass one. */
  defaultCredentialId?: string;
}

/**
 * Production client: Authorization: Bearer <vht_…>
 * Aligns with VH findings list shape `{ findings, total, counts }`.
 */
export class TokenVulnHunterClient implements VulnHunterClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly defaultCredentialId?: string;

  constructor(opts: TokenClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiToken = opts.apiToken;
    this.defaultCredentialId = opts.defaultCredentialId;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.apiToken}`);
    headers.set("accept", "application/json");
    const isForm =
      typeof FormData !== "undefined" && init.body instanceof FormData;
    // Let fetch set multipart boundary for FormData; JSON otherwise
    if (init.body && !headers.has("content-type") && !isForm) {
      headers.set("content-type", "application/json");
    }
    // 15s default; callers may pass longer signal (e.g. archive upload)
    const signal = init.signal ?? AbortSignal.timeout(15_000);
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal });
    return res;
  }

  async createScanTask(input: CreateScanTaskInput): Promise<{ taskId: string }> {
    const credentialId = input.credentialId ?? this.defaultCredentialId;
    const body: Record<string, unknown> = {
      git_url: input.gitUrl,
      // project_name = repo short name; display_name avoids VH 409 on repeats
      project_name: input.displayName.split(" ")[0] || input.displayName,
      display_name: input.displayName,
    };
    if (credentialId) body.credential_id = credentialId;

    // Optional scan knobs (VH JSON create body)
    if (input.scanTimeoutSeconds != null) {
      body.scan_timeout = input.scanTimeoutSeconds;
      body.timeout_mode = input.timeoutMode ?? "custom";
    } else if (input.timeoutMode) {
      body.timeout_mode = input.timeoutMode;
    }
    if (input.maxItemsPerRecon != null) body.max_items_per_recon = input.maxItemsPerRecon;
    if (input.agentMaxParallel != null) body.agent_max_parallel = input.agentMaxParallel;
    if (input.auditFocus) body.audit_focus = input.auditFocus;
    if (input.outputLanguage) body.output_language = input.outputLanguage;
    if (input.vulnFocus) body.vuln_focus = input.vulnFocus;
    if (input.enableDynamicVerify != null) body.enable_dynamic_verify = input.enableDynamicVerify;
    if (input.enableDynamicExploit != null) body.enable_dynamic_exploit = input.enableDynamicExploit;

    const res = await this.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VH createScanTask failed: ${res.status} ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as { task?: { id?: string }; id?: string };
    const taskId = data.task?.id ?? data.id;
    if (!taskId) throw new Error("VH createScanTask: missing task id");
    logger.info(
      {
        taskId,
        scanTimeoutSeconds: input.scanTimeoutSeconds,
        dynamicVerify: input.enableDynamicVerify,
        dynamicExploit: input.enableDynamicExploit,
        mode: "git",
      },
      "VH task created (token client)",
    );
    return { taskId };
  }

  async createScanTaskFromArchive(
    input: CreateScanTaskFromArchiveInput,
  ): Promise<{ taskId: string }> {
    const credentialId = input.credentialId ?? this.defaultCredentialId;
    const form = new FormData();
    // Blob/File for multipart — Node 22 FormData accepts Blob
    const blob = new Blob([new Uint8Array(input.archive)], { type: "application/zip" });
    form.append("file", blob, input.filename);
    form.append("display_name", input.displayName);
    if (credentialId) form.append("credential_id", credentialId);

    if (input.scanTimeoutSeconds != null) {
      form.append("scan_timeout", String(input.scanTimeoutSeconds));
      form.append("timeout_mode", input.timeoutMode ?? "custom");
    } else if (input.timeoutMode) {
      form.append("timeout_mode", input.timeoutMode);
    }
    if (input.maxItemsPerRecon != null) {
      form.append("max_items_per_recon", String(input.maxItemsPerRecon));
    }
    if (input.agentMaxParallel != null) {
      form.append("agent_max_parallel", String(input.agentMaxParallel));
    }
    if (input.auditFocus) form.append("audit_focus", input.auditFocus);
    if (input.outputLanguage) form.append("output_language", input.outputLanguage);
    if (input.vulnFocus) form.append("vuln_focus", input.vulnFocus);
    if (input.enableDynamicVerify != null) {
      form.append("enable_dynamic_verify", input.enableDynamicVerify ? "true" : "false");
    }
    if (input.enableDynamicExploit != null) {
      form.append("enable_dynamic_exploit", input.enableDynamicExploit ? "true" : "false");
    }

    // Do not set content-type — fetch sets multipart boundary
    const res = await this.request("/api/tasks", {
      method: "POST",
      body: form,
      // longer timeout for large uploads
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VH createScanTaskFromArchive failed: ${res.status} ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as { task?: { id?: string }; id?: string };
    const taskId = data.task?.id ?? data.id;
    if (!taskId) throw new Error("VH createScanTaskFromArchive: missing task id");
    logger.info(
      {
        taskId,
        bytes: input.archive.length,
        filename: input.filename,
        dynamicVerify: input.enableDynamicVerify,
        mode: "archive",
      },
      "VH task created from archive (token client)",
    );
    return { taskId };
  }

  async getTask(taskId: string): Promise<{
    state: VhTaskState;
    failureReason?: string | null;
    metadata?: Record<string, unknown> | null;
  }> {
    const res = await this.request(`/api/tasks/${taskId}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (isVhTaskNotFoundBody(res.status, text)) {
        throw new VhTaskGoneError(taskId);
      }
      throw new Error(`VH getTask failed: ${res.status} ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      task?: {
        state?: string;
        failure_reason?: string | null;
        metadata?: Record<string, unknown> | null;
      };
      state?: string;
      failure_reason?: string | null;
      metadata?: Record<string, unknown> | null;
    };
    const task = data.task;
    const state = (task?.state ?? data.state) as VhTaskState | undefined;
    if (!state) throw new Error("VH getTask: missing state");
    return {
      state,
      failureReason: task?.failure_reason ?? data.failure_reason ?? null,
      metadata: task?.metadata ?? data.metadata ?? null,
    };
  }

  async listFindings(taskId: string): Promise<VhFindingMeta[]> {
    // item_type=all — OpenVuln filter layer drops non-finding / bad poc_status
    const res = await this.request(
      `/api/tasks/${taskId}/findings?item_type=all&limit=1000`,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VH listFindings failed: ${res.status} ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      findings?: VhFindingMeta[];
      items?: VhFindingMeta[];
    };
    const list =
      data.findings ?? data.items ?? (Array.isArray(data) ? (data as VhFindingMeta[]) : []);
    // VH list rows use `finding_key` (not `key`)
    return list.map((f) => {
      const rec = f as Record<string, unknown>;
      const key = String(f.key || rec.finding_key || rec.id || "");
      return {
        ...f,
        key,
        // pass through common fields explicitly for sync filters
        item_type: (f.item_type ?? rec.item_type) as string | undefined,
        poc_status: (f.poc_status ?? rec.poc_status) as string | null | undefined,
        cvss_score: (f.cvss_score ?? rec.cvss_score) as number | null | undefined,
        cvss_vector: (f.cvss_vector ?? rec.cvss_vector) as string | null | undefined,
        cwe: (f.cwe ?? rec.cwe) as string | null | undefined,
        title: (f.title ?? rec.title) as string | undefined,
        primary_file: (f.primary_file ?? rec.primary_file) as string | null | undefined,
        severity: (f.severity ?? rec.severity) as string | undefined,
      };
    });
  }

  async getFindingDetail(taskId: string, key: string): Promise<unknown> {
    const res = await this.request(`/api/tasks/${taskId}/findings/${encodeURIComponent(key)}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VH getFindingDetail failed: ${res.status} ${text.slice(0, 500)}`);
    }
    return res.json();
  }

  async listFindingArtifacts(
    taskId: string,
    findingId: string,
  ): Promise<import("./client.js").VhFindingArtifactGroups> {
    const res = await this.request(
      `/api/tasks/${taskId}/findings/${encodeURIComponent(findingId)}/artifacts`,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VH listFindingArtifacts failed: ${res.status} ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as import("./client.js").VhFindingArtifactGroups;
    return {
      poc: { files: Array.isArray(data?.poc?.files) ? data.poc.files : [] },
      exp: { files: Array.isArray(data?.exp?.files) ? data.exp.files : [] },
    };
  }

  async getArtifactFilePreview(
    taskId: string,
    relPath: string,
  ): Promise<import("./client.js").VhArtifactFilePreview | null> {
    // VH expects path under findings/… or exploits/…
    const q = new URLSearchParams({ path: relPath });
    const res = await this.request(`/api/tasks/${taskId}/artifacts/file?${q}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VH getArtifactFilePreview failed: ${res.status} ${text.slice(0, 500)}`);
    }
    return (await res.json()) as import("./client.js").VhArtifactFilePreview;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        headers: { accept: "application/json" },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok && res.status !== 404) {
      const t = await res.text().catch(() => "");
      throw new Error(`VH deleteTask ${res.status}: ${t.slice(0, 200)}`);
    }
  }
}
