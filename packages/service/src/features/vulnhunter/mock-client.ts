import { randomUUID } from "node:crypto";
import type { VulnHunterClient, VhFindingMeta, VhTaskState } from "./client.js";

interface MockTask {
  state: VhTaskState;
  createdAt: number;
  gitUrl: string;
  findings: VhFindingMeta[];
  /** When true, getTask will not auto-advance state. */
  forced?: boolean;
}

/**
 * In-process mock: tasks auto-complete after ~5s with 2 sample findings.
 * Enabled via VULNHUNTER_MOCK=true.
 */
export class MockVulnHunterClient implements VulnHunterClient {
  private tasks = new Map<string, MockTask>();
  private completeAfterMs: number;

  constructor(opts?: { completeAfterMs?: number }) {
    this.completeAfterMs = opts?.completeAfterMs ?? 5_000;
  }

  async createScanTask(input: { gitUrl: string; displayName: string }): Promise<{ taskId: string }> {
    const taskId = randomUUID();
    this.tasks.set(taskId, {
      state: "queued",
      createdAt: Date.now(),
      gitUrl: input.gitUrl,
      findings: [
        {
          key: `mock-sqli-${taskId.slice(0, 8)}`,
          severity: "high",
          title: "SQL Injection in query builder",
          cwe: "CWE-89",
          primary_file: "src/db/query.ts",
        },
        {
          key: `mock-xss-${taskId.slice(0, 8)}`,
          severity: "medium",
          title: "Reflected XSS in search parameter",
          cwe: "CWE-79",
          primary_file: "src/web/search.tsx",
        },
      ],
    });
    return { taskId };
  }

  async getTask(taskId: string): Promise<{ state: VhTaskState }> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`Mock VH: unknown task ${taskId}`);

    if (!t.forced) {
      const age = Date.now() - t.createdAt;
      if (age < 1_000) t.state = "queued";
      else if (age < 2_500) t.state = "preparing";
      else if (age < this.completeAfterMs) t.state = "running";
      else t.state = "completed";
    }

    return { state: t.state };
  }

  async listFindings(taskId: string): Promise<VhFindingMeta[]> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`Mock VH: unknown task ${taskId}`);
    if (t.state !== "completed") return [];
    return t.findings;
  }

  async getFindingDetail(taskId: string, key: string): Promise<unknown> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`Mock VH: unknown task ${taskId}`);
    const meta = t.findings.find((f) => f.key === key);
    if (!meta) throw new Error(`Mock VH: unknown finding ${key}`);
    return {
      key: meta.key,
      severity: meta.severity,
      title: meta.title,
      cwe: meta.cwe,
      primary_file: meta.primary_file,
      description: `Mock finding detail for ${meta.title}. Powered by VulnHunter AI engine.`,
      code_snippet: `// vulnerable code at ${meta.primary_file}\nfunction handle(input) {\n  // ...\n}`,
      line_start: 42,
      line_end: 48,
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  /** Test helper: force a task into a state (disables auto-advance). */
  forceState(taskId: string, state: VhTaskState): void {
    const t = this.tasks.get(taskId);
    if (t) {
      t.state = state;
      t.forced = true;
    }
  }
}
