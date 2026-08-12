import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  setupTestApp,
  cleanTables,
  seedProject,
  seedScanJob,
  seedFinding,
  type TestContext,
} from "../../test/setup-db.js";

describe("stats overview", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("returns platform aggregates without poc_rate/cwe_count; excludes info", async () => {
    const { projectId } = await seedProject();
    const scanId = await seedScanJob(projectId, "completed");
    await seedFinding(projectId, scanId, { disclosure: "owner_only", severity: "high" });
    await seedFinding(projectId, scanId, {
      disclosure: "disclosed",
      key: "d1",
      severity: "medium",
      cvssScore: 5,
    });
    await seedFinding(projectId, scanId, {
      key: "info1",
      severity: "info",
      cvssScore: 0,
    });

    const res = await ctx.app.request("/api/stats/overview");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      project_count: number;
      scanned_project_count: number;
      finding_total: number;
      finding_disclosed_count: number;
      severity_counts: { high: number; medium: number };
      poc_rate?: number;
      cwe_count?: number;
    };
    expect(body.project_count).toBe(1);
    expect(body.scanned_project_count).toBe(1);
    expect(body.finding_total).toBe(2); // info excluded
    expect(body.finding_disclosed_count).toBe(1);
    expect(body.severity_counts.high).toBe(1);
    expect(body.severity_counts.medium).toBe(1);
    expect(body.poc_rate).toBeUndefined();
    expect(body.cwe_count).toBeUndefined();
  });
});
