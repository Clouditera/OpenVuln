/**
 * RED LINE: public routes must not expose owner_only finding details.
 * Owner self-service routes were REMOVED (task-90533568) — they 404 now,
 * which is strictly stronger than the former 403 stubs.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type TestContext,
  cleanTables,
  seedFinding,
  seedProject,
  seedScanJob,
  setupTestApp,
} from "../../test/setup-db.js";

describe("findings red line", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("public project view only lists disclosed findings (no path/code)", async () => {
    const { projectId, fullName } = await seedProject({ fullName: "acme/widget" });
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "secret-1",
      disclosure: "owner_only",
      title: "OWNER ONLY TITLE",
    });
    await seedFinding(projectId, scanId, {
      key: "public-1",
      disclosure: "disclosed",
      title: "Disclosed XSS",
    });

    const [owner, repo] = fullName.split("/");
    const res = await ctx.app.request(`/api/projects/${owner}/${repo}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      disclosed_findings: Array<{ title: string }>;
      severity_counts: { high: number; critical?: number };
    };

    expect(body.severity_counts.high).toBe(2);
    expect(body.disclosed_findings).toHaveLength(1);
    expect(body.disclosed_findings[0].title).toBe("Disclosed XSS");
    const dumped = JSON.stringify(body);
    expect(dumped).not.toContain("OWNER ONLY TITLE");
    expect(dumped).not.toContain("should never leak publicly");
    expect(dumped).not.toContain("src/secret.ts");
  });

  it("owner findings route does not exist (404)", async () => {
    const { projectId } = await seedProject();
    const res = await ctx.app.request(`/api/projects/${projectId}/findings`);
    expect(res.status).toBe(404);
  });

  it("owner disclose route does not exist (404)", async () => {
    const { projectId } = await seedProject();
    const res = await ctx.app.request(`/api/projects/${projectId}/disclose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ finding_ids: [] }),
    });
    expect(res.status).toBe(404);
  });

  it("info severity is not exposed in public counts", async () => {
    const { projectId, fullName } = await seedProject({ fullName: "acme/info-hide" });
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "info-1",
      severity: "info",
      cvssScore: 0,
      title: "INFO NOISE",
    });
    await seedFinding(projectId, scanId, {
      key: "hi-1",
      severity: "high",
      cvssScore: 8,
      title: "Real high",
    });
    const [owner, repo] = fullName.split("/");
    const res = await ctx.app.request(`/api/projects/${owner}/${repo}`);
    const body = (await res.json()) as {
      severity_counts: Record<string, number>;
    };
    expect(body.severity_counts.high).toBe(1);
    expect(body.severity_counts).not.toHaveProperty("info");
    expect(JSON.stringify(body)).not.toContain("INFO NOISE");
  });
});
