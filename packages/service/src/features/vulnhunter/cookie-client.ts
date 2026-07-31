import { logger } from "../../infra/logger.js";
import type { VulnHunterClient, VhFindingMeta, VhTaskState } from "./client.js";

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
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (res.status === 401 && !retried) {
      logger.warn("VH 401 — re-login once");
      this.cookie = null;
      await this.login();
      return this.request(path, init, true);
    }
    return res;
  }

  async createScanTask(input: { gitUrl: string; displayName: string }): Promise<{ taskId: string }> {
    const res = await this.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        git_url: input.gitUrl,
        project_name: input.displayName,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`VH createScanTask failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { task?: { id?: string }; id?: string };
    const taskId = data.task?.id ?? data.id;
    if (!taskId) throw new Error("VH createScanTask: missing task id in response");
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

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
