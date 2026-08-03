import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  setupTestApp,
  cleanTables,
  seedProject,
  type TestContext,
} from "../../test/setup-db.js";
import { scanStorage, scanQueueInternal } from "./index.js";
import { findingsStorage } from "../findings/index.js";

describe("scan queue integration", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("dispatch → poll → findings filtered + NVD mapped", async () => {
    const { projectId } = await seedProject({ fullName: "acme/scan-me" });
    const job = await scanStorage.createScanJob(projectId, "deadbeef");

    await scanQueueInternal.dispatchOnce(2);
    const afterDispatch = await scanStorage.getScanJob(job.id);
    expect(afterDispatch?.state).toBe("scanning");
    ctx.mockVh.forceState(afterDispatch!.vulnhunter_task_id!, "completed");
    await scanQueueInternal.pollOnce();

    const done = await scanStorage.getScanJob(job.id);
    expect(done?.state).toBe("completed");
    expect(done?.findings_so_far).toBe(3); // crit + high + med; risk/failed filtered

    const counts = await findingsStorage.severityCounts(projectId);
    expect(counts.critical).toBe(1);
    expect(counts.high).toBe(1);
    expect(counts.medium).toBe(1);
    expect(counts.low).toBe(0);
  });

  it("respects concurrency slots", async () => {
    const a = await seedProject({ fullName: "acme/a", stars: 5 });
    const b = await seedProject({ fullName: "acme/b", stars: 5 });
    await scanStorage.createScanJob(a.projectId, null);
    await scanStorage.createScanJob(b.projectId, null);

    await scanQueueInternal.dispatchOnce(1);
    expect(await scanStorage.countInFlight()).toBe(1);
  });

  it("VH task gone → hard-deletes job+project and frees slot", async () => {
    const { projectId } = await seedProject({ fullName: "acme/gone-me" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanQueueInternal.dispatchOnce(2);
    const scanning = await scanStorage.getScanJob(job.id);
    expect(scanning?.state).toBe("scanning");
    const vhId = scanning!.vulnhunter_task_id!;
    ctx.mockVh.forceGone(vhId);
    await scanQueueInternal.pollOnce(3);
    expect(await scanStorage.getScanJob(job.id)).toBeNull();
    // project gone when no remaining jobs
    const db = (await import("../../infra/db/index.js")).getDb();
    const rows = await db`SELECT id FROM projects WHERE id = ${projectId}::uuid`;
    expect(rows.length).toBe(0);
    expect(await scanStorage.countInFlight()).toBe(0);
  });

  it("VH cancelled → keeps scanning (no fail)", async () => {
    const { projectId } = await seedProject({ fullName: "acme/cancel-me" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanQueueInternal.dispatchOnce(2);
    const scanning = await scanStorage.getScanJob(job.id);
    ctx.mockVh.forceState(scanning!.vulnhunter_task_id!, "cancelled");
    await scanQueueInternal.pollOnce(3);
    const after = await scanStorage.getScanJob(job.id);
    expect(after?.state).toBe("scanning");
    expect(after?.fail_reason_internal).toBeNull();
  });

  it("unknown VH state × grace → failed", async () => {
    const { projectId } = await seedProject({ fullName: "acme/weird-state" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanQueueInternal.dispatchOnce(2);
    const scanning = await scanStorage.getScanJob(job.id);
    ctx.mockVh.forceState(scanning!.vulnhunter_task_id!, "stopped_by_ops");
    await scanQueueInternal.pollOnce(2);
    await scanQueueInternal.pollOnce(2);
    const failed = await scanStorage.getScanJob(job.id);
    expect(failed?.state).toBe("failed");
    expect(failed?.fail_reason_internal ?? "").toMatch(/unknown/);
  });

  it("admin finalize marks in-flight failed", async () => {
    const { projectId } = await seedProject({ fullName: "acme/finalize-me" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanQueueInternal.dispatchOnce(2);
    const done = await scanStorage.finalizeInFlight(job.id, "admin_finalize:test");
    expect(done?.state).toBe("failed");
    expect(await scanStorage.finalizeInFlight(job.id, "again")).toBeNull();
  });

  it("VH no-scan-value failure → completed empty (Scanned + 0)", async () => {
    const { projectId } = await seedProject({ fullName: "acme/empty-src" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanQueueInternal.dispatchOnce(2);
    const scanning = await scanStorage.getScanJob(job.id);
    ctx.mockVh.forceFailed(scanning!.vulnhunter_task_id!, {
      failureReason: "Error: 源码不完整：功能代码缺失，无法建立完整的代码功能语义。",
      metadata: { source_incomplete: true, prepare: { reason: "partial_source" } },
    });
    await scanQueueInternal.pollOnce(3);
    const done = await scanStorage.getScanJob(job.id);
    expect(done?.state).toBe("completed");
    expect(done?.findings_so_far).toBe(0);
    expect(done?.fail_reason_internal ?? "").toMatch(/no_scan_value/);
    const counts = await findingsStorage.severityCounts(projectId);
    expect(counts.critical + counts.high + counts.medium + counts.low).toBe(0);
  });

  it("VH ordinary failure still marks failed after grace", async () => {
    const { projectId } = await seedProject({ fullName: "acme/real-fail" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanQueueInternal.dispatchOnce(2);
    const scanning = await scanStorage.getScanJob(job.id);
    ctx.mockVh.forceFailed(scanning!.vulnhunter_task_id!, {
      failureReason: "worker OOM killed",
    });
    await scanQueueInternal.pollOnce(1);
    const failed = await scanStorage.getScanJob(job.id);
    expect(failed?.state).toBe("failed");
    expect(failed?.fail_reason_internal ?? "").toMatch(/vh_state:failed/);
  });
});
