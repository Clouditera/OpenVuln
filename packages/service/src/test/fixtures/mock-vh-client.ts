import { randomUUID } from "node:crypto";
import {
  type VulnHunterClient,
  type VhArtifactFilePreview,
  type VhFindingArtifactGroups,
  type VhFindingMeta,
  type VhTaskState,
  VhTaskGoneError,
} from "../../features/vulnhunter/client.js";

/** Soft cap for harvested text (bytes of UTF-8). */
export const MOCK_ARTIFACT_MAX_CHARS = 1_000_000;

interface MockTask {
  state: VhTaskState;
  createdAt: number;
  gitUrl: string;
  findings: VhFindingMeta[];
  forced?: boolean;
}

/**
 * In-process mock. Findings appear while running (so_far) and complete after ~5s.
 * Includes CVSS scores for NVD mapping tests.
 */
export class MockVulnHunterClient implements VulnHunterClient {
  private tasks = new Map<string, MockTask>();
  private completeAfterMs: number;

  constructor(opts?: { completeAfterMs?: number }) {
    this.completeAfterMs = opts?.completeAfterMs ?? 5_000;
  }

  async createScanTask(input: {
    gitUrl: string;
    displayName: string;
    [extra: string]: unknown;
  }): Promise<{ taskId: string }> {
    return this.spawnTask(input.gitUrl);
  }

  async createScanTaskFromArchive(input: {
    displayName: string;
    archive: Buffer;
    filename: string;
    [extra: string]: unknown;
  }): Promise<{ taskId: string }> {
    if (!input.archive?.length) throw new Error("Mock VH: empty archive");
    return this.spawnTask(`archive://${input.filename}`);
  }

  private async spawnTask(gitUrl: string): Promise<{ taskId: string }> {
    const taskId = randomUUID();
    this.tasks.set(taskId, {
      state: "queued",
      createdAt: Date.now(),
      gitUrl,
      // Stable finding_key values (no task id) so rescan/retry preserves disclosure by key.
      findings: [
        {
          key: "mock-rce",
          severity: "high",
          title: "Remote code execution via deserialization",
          cwe: "CWE-502",
          primary_file: "src/serde/handler.ts",
          item_type: "finding",
          poc_status: "confirmed",
          cvss_score: 9.8,
          cvss_vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        },
        {
          key: "mock-sqli",
          severity: "high",
          title: "SQL Injection in query builder",
          cwe: "CWE-89",
          primary_file: "src/db/query.ts",
          item_type: "finding",
          poc_status: "confirmed",
          cvss_score: 8.1,
          cvss_vector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N",
        },
        {
          key: "mock-xss",
          severity: "medium",
          title: "Reflected XSS in search parameter",
          cwe: "CWE-79",
          primary_file: "src/web/search.tsx",
          item_type: "finding",
          poc_status: "not-needed",
          cvss_score: 5.4,
          cvss_vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N",
        },
        {
          key: "mock-risk",
          severity: "low",
          title: "Risk item should be filtered",
          cwe: "CWE-200",
          item_type: "risk",
          poc_status: "unknown",
          cvss_score: 3.1,
        },
        {
          key: "mock-failed-poc",
          severity: "high",
          title: "Failed poc should be filtered",
          cwe: "CWE-78",
          item_type: "finding",
          poc_status: "failed",
          cvss_score: 7.5,
        },
      ],
    });
    return { taskId };
  }

  async getTask(taskId: string): Promise<{
    state: VhTaskState;
    failureReason?: string | null;
    metadata?: Record<string, unknown> | null;
  }> {
    const t = this.tasks.get(taskId) as MockTask & {
      failureReason?: string;
      metadata?: Record<string, unknown>;
    };
    if (!t) throw new VhTaskGoneError(taskId);

    if (!t.forced) {
      const age = Date.now() - t.createdAt;
      if (age < 1_000) t.state = "queued";
      else if (age < 2_500) t.state = "preparing";
      else if (age < this.completeAfterMs) t.state = "running";
      else t.state = "completed";
    }

    return {
      state: t.state,
      failureReason: t.failureReason ?? null,
      metadata: t.metadata ?? null,
    };
  }

  /** Test: mark task failed with optional reason/metadata (no-scan-value cases). */
  forceFailed(
    taskId: string,
    opts?: { failureReason?: string; metadata?: Record<string, unknown> },
  ): void {
    const t = this.tasks.get(taskId) as MockTask & {
      failureReason?: string;
      metadata?: Record<string, unknown>;
    };
    if (!t) throw new Error(`Mock VH: unknown task ${taskId}`);
    t.state = "failed";
    t.forced = true;
    t.failureReason = opts?.failureReason;
    t.metadata = opts?.metadata;
  }

  /** Test helper: remove task so getTask throws VhTaskGoneError. */
  forceGone(taskId: string): void {
    this.tasks.delete(taskId);
  }

  /** Fail next N deleteTask calls with this error message (then succeed). */
  private deleteFailLeft = 0;
  private deleteFailMsg = "ERR_TASK_BUSY";
  forceDeleteBusy(times = 1, msg = "ERR_TASK_BUSY"): void {
    this.deleteFailLeft = times;
    this.deleteFailMsg = msg;
  }

  async deleteTask(taskId: string): Promise<void> {
    if (this.deleteFailLeft > 0) {
      this.deleteFailLeft -= 1;
      throw new Error(this.deleteFailMsg);
    }
    this.tasks.delete(taskId);
  }

  /** Test helper: force a raw VH state string (including unknown). */
  forceState(taskId: string, state: VhTaskState): void {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`Mock VH: unknown task ${taskId}`);
    t.state = state;
    t.forced = true;
  }

  async listFindings(taskId: string): Promise<VhFindingMeta[]> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`Mock VH: unknown task ${taskId}`);
    // While running, expose partial findings so so_far works
    if (t.state === "running" || t.state === "completed") return t.findings;
    return [];
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
      item_type: meta.item_type,
      poc_status: meta.poc_status,
      cvss_score: meta.cvss_score,
      cvss_vector: meta.cvss_vector,
      description: `Mock finding detail for ${meta.title}.`,
      code_snippet: `// vulnerable code at ${meta.primary_file}\nfunction handle(input) {\n  // ...\n}`,
    };
  }

  async listFindingArtifacts(
    taskId: string,
    findingId: string,
  ): Promise<VhFindingArtifactGroups> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`Mock VH: unknown task ${taskId}`);
    const meta = t.findings.find((f) => f.key === findingId);
    if (!meta || meta.item_type === "risk") {
      return { poc: { files: [] }, exp: { files: [] } };
    }
    // confirmed findings get a text poc; others empty (mirrors pending reality)
    if (meta.poc_status === "confirmed") {
      return {
        poc: {
          files: [
            {
              path: `poc/poc.md`,
              size: 120,
              kind: "text",
              previewable: true,
            },
          ],
        },
        exp: {
          files:
            meta.key === "mock-rce"
              ? [{ path: `exp/exp.py`, size: 80, kind: "text", previewable: true }]
              : [],
        },
      };
    }
    return { poc: { files: [] }, exp: { files: [] } };
  }

  async getArtifactFilePreview(
    taskId: string,
    relPath: string,
  ): Promise<VhArtifactFilePreview | null> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`Mock VH: unknown task ${taskId}`);
    // report.yaml (byte-faithful source for disclose)
    const yamlM = /^findings\/([^/]+)\/report\.yaml$/.exec(relPath);
    if (yamlM) {
      const key = yamlM[1];
      const meta = t.findings.find((f) => f.key === key);
      if (!meta) return null;
      const body = [
        "metadata:",
        `  title: ${JSON.stringify(meta.title)}`,
        `  cwe: ${meta.cwe ?? "CWE-000"}`,
        `  severity: ${meta.severity}`,
        "description:",
        `  summary: Mock report.yaml for ${meta.key}`,
        "",
      ].join("\n");
      return {
        kind: "text",
        size: body.length,
        language: "yaml",
        content: body,
        truncated: false,
        mime: "text/yaml",
      };
    }
    // path form: findings/<key>/poc/poc.md
    const m = /^findings\/([^/]+)\/(poc|exp)\/(.+)$/.exec(relPath);
    if (!m) return null;
    const [, key, kind, file] = m;
    const meta = t.findings.find((f) => f.key === key);
    if (!meta || meta.poc_status !== "confirmed") return null;
    if (kind === "exp" && key !== "mock-rce") return null;
    const body =
      kind === "poc"
        ? `# PoC for ${meta.title}\n\nSteps:\n1. trigger ${meta.primary_file}\n2. observe RCE/injection\n`
        : `#!/usr/bin/env python3\n# exp for ${meta.title}\nprint("pwn")\n`;
    return {
      kind: "text",
      size: body.length,
      language: file.endsWith(".py") ? "python" : "markdown",
      content: body,
      truncated: false,
      mime: file.endsWith(".py") ? "text/x-python" : "text/markdown",
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
