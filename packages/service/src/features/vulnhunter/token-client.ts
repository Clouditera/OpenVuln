import type { VulnHunterClient, VhFindingMeta, VhTaskState } from "./client.js";

interface TokenClientOptions {
  baseUrl: string;
  apiToken: string;
}

/** Future client once VulnHunter ships Bearer API tokens. */
export class TokenVulnHunterClient implements VulnHunterClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;

  constructor(opts: TokenClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiToken = opts.apiToken;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.apiToken}`);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return fetch(`${this.baseUrl}${path}`, { ...init, headers });
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
    if (!taskId) throw new Error("VH createScanTask: missing task id");
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
