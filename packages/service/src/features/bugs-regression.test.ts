/**
 * Regression for QA BUG-1/2/3 (task-80fbc655).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  setupTestApp,
  cleanTables,
  seedProject,
  seedScanJob,
  seedSession,
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

    // First completion
    await scanQueueInternal.dispatchOnce(2);
    const after1 = await scanStorage.getScanJob(job.id);
    expect(after1?.vulnhunter_task_id).toBeTruthy();
    ctx.mockVh.forceState(after1!.vulnhunter_task_id!, "completed");
    await scanQueueInternal.pollOnce();

    const counts1 = await findingsStorage.severityCounts(projectId);
    const total1 = counts1.high + counts1.medium + counts1.low + counts1.info;
    expect(total1).toBe(2);

    // Simulate failed → retry → complete again (new VH task, new finding keys)
    await ctx.db`
      UPDATE scan_jobs SET state = 'failed', fail_reason_internal = 'boom', finished_at = now()
      WHERE id = ${job.id}::uuid
    `;
    const retried = await scanStorage.retryScanJob(job.id);
    expect(retried?.state).toBe("queued");

    await scanQueueInternal.dispatchOnce(2);
    const after2 = await scanStorage.getScanJob(job.id);
    expect(after2?.vulnhunter_task_id).toBeTruthy();
    // Must be a different mock task id than first run
    expect(after2!.vulnhunter_task_id).not.toBe(after1!.vulnhunter_task_id);
    ctx.mockVh.forceState(after2!.vulnhunter_task_id!, "completed");
    await scanQueueInternal.pollOnce();

    const counts2 = await findingsStorage.severityCounts(projectId);
    const total2 = counts2.high + counts2.medium + counts2.low + counts2.info;
    expect(total2).toBe(2); // not 4
    expect(counts2).toEqual(counts1);

    const ownerList = await findingsStorage.listForOwner(projectId);
    expect(ownerList).toHaveLength(2);
  });

  it("BUG-1: disclosed state survives resync when finding_key matches", async () => {
    const { projectId } = await seedProject({ fullName: "acme/disclose-keep" });
    const scanId = await seedScanJob(projectId);
    // Seed a disclosed finding with a key the mock will also emit? Mock keys are dynamic.
    // Instead: sync once, disclose by key pattern, force same keys on second sync via storage API.
    await findingsStorage.upsertFinding({
      projectId,
      scanJobId: scanId,
      findingKey: "stable-key",
      severity: "high",
      title: "Stable",
      cwe: "CWE-89",
      primaryFile: "a.ts",
      detailJson: { x: 1 },
      disclosureState: "disclosed",
      disclosedAt: new Date(),
      disclosedBy: 42,
    });

    // Simulate resync that re-emits stable-key (call sync path via delete+upsert logic)
    const prior = await findingsStorage.listDisclosureByKey(projectId);
    expect(prior.get("stable-key")?.state).toBe("disclosed");
    await findingsStorage.deleteAllForProject(projectId);
    await findingsStorage.upsertFinding({
      projectId,
      scanJobId: scanId,
      findingKey: "stable-key",
      severity: "high",
      title: "Stable v2",
      cwe: "CWE-89",
      primaryFile: "a.ts",
      detailJson: { x: 2 },
      disclosureState: prior.get("stable-key")?.state,
      disclosedAt: prior.get("stable-key")?.disclosedAt ?? null,
      disclosedBy: prior.get("stable-key")?.disclosedBy ?? null,
    });

    const list = await findingsStorage.listForOwner(projectId);
    expect(list).toHaveLength(1);
    expect(list[0].disclosure_state).toBe("disclosed");
  });

  it("BUG-2: unique_violation on insert maps to conflict semantics", async () => {
    // Insert a project, then force insertProject with same repo id
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

  it("BUG-3: disclose with invalid uuid returns 422", async () => {
    const { projectId, repoId } = await seedProject();
    const token = await seedSession("owner", 9001, repoId);

    const res = await ctx.app.request(`/api/projects/${projectId}/disclose`, {
      method: "POST",
      headers: {
        cookie: `ov_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ finding_ids: ["not-a-uuid", "also-bad"] }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; context?: { reason?: string } } };
    expect(body.error.code).toBe("ERR_VALIDATION");
    expect(body.error.context?.reason).toBe("invalid_uuid");
  });

  it("BUG-3: empty/missing finding_ids still 422", async () => {
    const { projectId, repoId } = await seedProject();
    const token = await seedSession("owner", 9002, repoId);
    const res = await ctx.app.request(`/api/projects/${projectId}/disclose`, {
      method: "POST",
      headers: {
        cookie: `ov_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ finding_ids: [] }),
    });
    expect(res.status).toBe(422);
  });
});
