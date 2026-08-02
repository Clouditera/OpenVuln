import { logger } from "../../infra/logger.js";
import type {
  CreateScanTaskFromArchiveInput,
  CreateScanTaskInput,
  VulnHunterClient,
  VhFindingMeta,
  VhTaskState,
} from "./client.js";

interface CookieClientOptions {
  baseUrl: string;
  username: string;
  password: string;
}

/**
 * Transition-period client: login with email/password, hold session cookie.
 * Auto-relogin once on 401.
 */
export class CookieVulnHunterClient implements VulnHunterClient {
  private cookie: string | null = null;
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;

  constructor(opts: CookieClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.username = opts.username;
    this.password = opts.password;
  }

  private async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.username, password: this.password }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`VH login failed: ${res.status} ${body}`);
    }
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length === 0) {
      // Node fetch may expose via raw header
      const raw = res.headers.get("set-cookie");
      if (!raw) throw new Error("VH login: no set-cookie header");
      this.cookie = raw.split(",").map((c) => c.split(";")[0].trim()).join("; ");
    } else {
      this.cookie = setCookie.map((c) => c.split(";")[0].trim()).join("; ");
    }
    logger.info("VulnHunter cookie client logged in");
  }

  private async ensureLogin(): Promise<void> {
    if (!this.cookie) await this.login();
  }

  private async request(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    await this.ensureLogin();
    const headers = new Headers(init.headers);
    headers.set("cookie", this.cookie ?? "");
    const isForm =
      typeof FormData !== "undefined" && init.body instanceof FormData;
    if (init.body && !headers.has("content-type") && !isForm) {
      headers.set("content-type", "application/json");
    }
    const signal = init.signal ?? AbortSignal.timeout(15_000);
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal });
    if (res.status === 401 && !retried) {
      logger.warn("VH 401 — re-login once");
      this.cookie = null;
      await this.login();
      return this.request(path, init, true);
    }
    return res;
  }

  async createScanTask(input: CreateScanTaskInput): Promise<{ taskId: string }> {
    const body: Record<string, unknown> = {
      git_url: input.gitUrl,
      project_name: input.displayName.split(" ")[0] || input.displayName,
      display_name: input.displayName,
    };
    if (input.credentialId) body.credential_id = input.credentialId;
    if (input.scanTimeoutSeconds != null) {
      body.scan_timeout = input.scanTimeoutSeconds;
      body.timeout_mode = input.timeoutMode ?? "custom";
    } else if (input.timeoutMode) {
      body.timeout_mode = input.timeoutMode;
    }
    if (input.maxItemsPerRecon != null) body.max_items_per_recon = input.maxItemsPerRecon;
    if (input.agentMaxParallel != null) body.agent_max_parallel = input.agentMaxParallel;
    if (input.auditFocus) body.audit_focus = input.auditFocus;
    if (input.enableDynamicVerify != null) body.enable_dynamic_verify = input.enableDynamicVerify;
    if (input.enableDynamicExploit != null) body.enable_dynamic_exploit = input.enableDynamicExploit;

    const res = await this.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VH createScanTask failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { task?: { id?: string }; id?: string };
    const taskId = data.task?.id ?? data.id;
    if (!taskId) throw new Error("VH createScanTask: missing task id in response");
    return { taskId };
  }

  async createScanTaskFromArchive(
    input: CreateScanTaskFromArchiveInput,
  ): Promise<{ taskId: string }> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.archive)], { type: "application/zip" });
    form.append("file", blob, input.filename);
    form.append("display_name", input.displayName);
    if (input.credentialId) form.append("credential_id", input.credentialId);
    if (input.scanTimeoutSeconds != null) {
      form.append("scan_timeout", String(input.scanTimeoutSeconds));
      form.append("timeout_mode", input.timeoutMode ?? "custom");
    }
    if (input.maxItemsPerRecon != null) {
      form.append("max_items_per_recon", String(input.maxItemsPerRecon));
    }
    if (input.agentMaxParallel != null) {
      form.append("agent_max_parallel", String(input.agentMaxParallel));
    }
    if (input.auditFocus) form.append("audit_focus", input.auditFocus);
    if (input.enableDynamicVerify != null) {
      form.append("enable_dynamic_verify", input.enableDynamicVerify ? "true" : "false");
    }
    if (input.enableDynamicExploit != null) {
      form.append("enable_dynamic_exploit", input.enableDynamicExploit ? "true" : "false");
    }
    const res = await this.request("/api/tasks", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VH createScanTaskFromArchive failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { task?: { id?: string }; id?: string };
    const taskId = data.task?.id ?? data.id;
    if (!taskId) throw new Error("VH createScanTaskFromArchive: missing task id");
    return { taskId };
  }

  async getTask(taskId: string): Promise<{ state: VhTaskState }> {
    const res = await this.request(`/api/tasks/${taskId}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`VH getTask failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { task?: { state?: string }; state?: string };
    const state = (data.task?.state ?? data.state) as VhTaskState | undefined;
    if (!state) throw new Error("VH getTask: missing state");
    return { state };
  }

  async listFindings(taskId: string): Promise<VhFindingMeta[]> {
    const res = await this.request(`/api/tasks/${taskId}/findings`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`VH listFindings failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { findings?: VhFindingMeta[]; items?: VhFindingMeta[] };
    return data.findings ?? data.items ?? (Array.isArray(data) ? (data as VhFindingMeta[]) : []);
  }

  async getFindingDetail(taskId: string, key: string): Promise<unknown> {
    const res = await this.request(`/api/tasks/${taskId}/findings/${encodeURIComponent(key)}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`VH getFindingDetail failed: ${res.status} ${body}`);
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
      const body = await res.text().catch(() => "");
      throw new Error(`VH listFindingArtifacts failed: ${res.status} ${body}`);
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
    const q = new URLSearchParams({ path: relPath });
    const res = await this.request(`/api/tasks/${taskId}/artifacts/file?${q}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`VH getArtifactFilePreview failed: ${res.status} ${body}`);
    }
    return (await res.json()) as import("./client.js").VhArtifactFilePreview;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
