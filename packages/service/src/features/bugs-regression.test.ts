/**
 * Regression for QA BUG-1/2/3 + admin token.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  setupTestApp,
  cleanTables,
  seedProject,
  seedScanJob,
  type TestContext,
} from "../test/setup-db.js";
import { scanStorage, scanQueueInternal } from "./scans/index.js";
import { findingsStorage } from "./findings/index.js";
import * as projectStorage from "./projects/storage.js";

describe("BUG regressions", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("BUG-1: resync/retry does not double severity_counts", async () => {
    const { projectId } = await seedProject({ fullName: "acme/retry-me" });
    const job = await scanStorage.createScanJob(projectId, "sha1");

    await scanQueueInternal.dispatchOnce(2);
    const after1 = await scanStorage.getScanJob(job.id);
    expect(after1?.vulnhunter_task_id).toBeTruthy();
    ctx.mockVh.forceState(after1!.vulnhunter_task_id!, "completed");
    await scanQueueInternal.pollOnce();

    const counts1 = await findingsStorage.severityCounts(projectId);
    const total1 = counts1.critical + counts1.high + counts1.medium + counts1.low;
    // mock yields critical+high+medium after filter (risk/failed dropped)
    expect(total1).toBe(3);

    await ctx.db`
      UPDATE scan_jobs SET state = 'failed', fail_reason_internal = 'boom', finished_at = now()
      WHERE id = ${job.id}::uuid
    `;
    const retried = await scanStorage.retryScanJob(job.id);
    expect(retried?.state).toBe("queued");

    await scanQueueInternal.dispatchOnce(2);
    const after2 = await scanStorage.getScanJob(job.id);
    ctx.mockVh.forceState(after2!.vulnhunter_task_id!, "completed");
    await scanQueueInternal.pollOnce();

    const counts2 = await findingsStorage.severityCounts(projectId);
    const total2 = counts2.critical + counts2.high + counts2.medium + counts2.low;
    expect(total2).toBe(total1);
  });

  it("BUG-2: unique_violation on insert maps to conflict semantics", async () => {
    const { repoId } = await seedProject({ fullName: "acme/race" });
    await expect(
      projectStorage.insertProject({
        githubRepoId: repoId,
        ownerLogin: "acme",
        name: "race",
        fullName: "acme/race",
        htmlUrl: "https://github.com/acme/race",
        description: null,
        language: null,
        stars: 0,
        defaultBranch: "main",
      }),
    ).rejects.toSatisfy((err: unknown) => projectStorage.isUniqueViolation(err));
  });

  it("admin token required", async () => {
    const noTok = await ctx.app.request("/api/admin/queue");
    expect(noTok.status).toBe(401);

    const bad = await ctx.app.request("/api/admin/queue", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(bad.status).toBe(401);

    const ok = await ctx.app.request("/api/admin/queue", {
      headers: { authorization: "Bearer test-admin-token" },
    });
    expect(ok.status).toBe(200);
  });

  it("queue priority prefers higher stars", async () => {
    const low = await seedProject({ fullName: "acme/low", stars: 1 });
    const high = await seedProject({ fullName: "acme/high", stars: 99999 });
    await scanStorage.createScanJob(low.projectId, null);
    await scanStorage.createScanJob(high.projectId, null);

    await scanQueueInternal.dispatchOnce(1);
    const queue = await scanStorage.listQueue();
    const scanning = queue.find((j) => j.state === "scanning" || j.state === "dispatching");
    expect(scanning?.project_full_name).toBe("acme/high");
  });
});
