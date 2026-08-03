import { describe, expect, it } from "vitest";
import { MockVulnHunterClient } from "./mock-vh-client.js";

describe("MockVulnHunterClient", () => {
  it("creates task and completes with mixed findings", async () => {
    const client = new MockVulnHunterClient({ completeAfterMs: 10 });
    const { taskId } = await client.createScanTask({
      gitUrl: "https://github.com/foo/bar",
      displayName: "foo/bar #1",
    });
    client.forceState(taskId, "completed");
    const { state } = await client.getTask(taskId);
    expect(state).toBe("completed");
    const findings = await client.listFindings(taskId);
    expect(findings.length).toBeGreaterThanOrEqual(3);
    expect(findings.some((f) => f.cvss_score && f.cvss_score >= 9)).toBe(true);
  });

  it("healthCheck always true", async () => {
    expect(await new MockVulnHunterClient().healthCheck()).toBe(true);
  });
});
