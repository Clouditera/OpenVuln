import { describe, expect, it } from "vitest";
import { MockVulnHunterClient } from "./mock-client.js";

describe("MockVulnHunterClient", () => {
  it("creates task and completes with findings", async () => {
    const client = new MockVulnHunterClient({ completeAfterMs: 10 });
    const { taskId } = await client.createScanTask({
      gitUrl: "https://github.com/foo/bar",
      displayName: "foo/bar #1",
    });

    // Force complete
    client.forceState(taskId, "completed");
    const { state } = await client.getTask(taskId);
    expect(state).toBe("completed");

    const findings = await client.listFindings(taskId);
    expect(findings.length).toBe(2);
    expect(findings[0].severity).toBe("high");

    const detail = (await client.getFindingDetail(taskId, findings[0].key)) as { title?: string };
    expect(detail.title).toBeTruthy();
  });

  it("healthCheck always true", async () => {
    const client = new MockVulnHunterClient();
    expect(await client.healthCheck()).toBe(true);
  });
});
