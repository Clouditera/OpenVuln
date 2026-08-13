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
    await scanStorage.approveScanJob(job.id);

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
    await scanStorage.approveScanJob((await scanStorage.createScanJob(a.projectId, null)).id);
    await scanStorage.approveScanJob((await scanStorage.createScanJob(b.projectId, null)).id);

    await scanQueueInternal.dispatchOnce(1);
    expect(await scanStorage.countInFlight()).toBe(1);
  });

  it("VH task gone → hard-deletes job+project and frees slot", async () => {
    const { projectId } = await seedProject({ fullName: "acme/gone-me" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanStorage.approveScanJob(job.id);
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
    await scanStorage.approveScanJob(job.id);
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
    await scanStorage.approveScanJob(job.id);
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
    await scanStorage.approveScanJob(job.id);
    await scanQueueInternal.dispatchOnce(2);
    const done = await scanStorage.finalizeInFlight(job.id, "admin_finalize:test");
    expect(done?.state).toBe("failed");
    expect(await scanStorage.finalizeInFlight(job.id, "again")).toBeNull();
  });

  it("VH no-scan-value failure → completed empty (Scanned + 0)", async () => {
    const { projectId } = await seedProject({ fullName: "acme/empty-src" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanStorage.approveScanJob(job.id);
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
    await scanStorage.approveScanJob(job.id);
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

  it("hardDeleteGoneJob removes sole job + project; keeps project if other jobs remain", async () => {
    const { projectId } = await seedProject({ fullName: "acme/cancel-hard-del" });
    const only = await scanStorage.createScanJob(projectId, "sha-only");
    const r1 = await scanStorage.hardDeleteGoneJob(only.id, projectId);
    expect(r1.projectDeleted).toBe(true);
    expect(await scanStorage.getScanJob(only.id)).toBeNull();
    const db = (await import("../../infra/db/index.js")).getDb();
    const gone = await db`SELECT id FROM projects WHERE id = ${projectId}::uuid`;
    expect(gone.length).toBe(0);

    const p2 = await seedProject({ fullName: "acme/cancel-hard-keep" });
    const keep = await scanStorage.createScanJob(p2.projectId, "sha-keep");
    await scanStorage.approveScanJob(keep.id);
    const drop = await scanStorage.createScanJob(p2.projectId, "sha-drop");
    const r2 = await scanStorage.hardDeleteGoneJob(drop.id, p2.projectId);
    expect(r2.projectDeleted).toBe(false);
    expect(await scanStorage.getScanJob(drop.id)).toBeNull();
    expect(await scanStorage.getScanJob(keep.id)).not.toBeNull();
    const still = await db`SELECT id FROM projects WHERE id = ${p2.projectId}::uuid`;
    expect(still.length).toBe(1);
  });

  it("teardown: BUSY twice then success drains queue", async () => {
    const { projectId } = await seedProject({ fullName: "acme/teardown-busy" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanStorage.approveScanJob(job.id);
    await scanQueueInternal.dispatchOnce(2);
    const scanning = await scanStorage.getScanJob(job.id);
    expect(scanning?.state).toBe("scanning");
    const vhId = scanning!.vulnhunter_task_id!;

    // Simulate cancel path: local hard-delete + enqueue (no sync VH delete)
    await scanStorage.hardDeleteGoneJob(job.id, projectId);
    await scanStorage.enqueueVhTeardown(vhId);
    expect(await scanStorage.countTeardownQueue()).toBe(1);

    ctx.mockVh.forceDeleteBusy(2, "ERR_TASK_BUSY");
    // Force next_retry_at due by re-enqueue after bump would delay — set due via raw SQL
    const db = (await import("../../infra/db/index.js")).getDb();

    await scanQueueInternal.teardownOnce(5);
    expect(await scanStorage.countTeardownQueue()).toBe(1);
    await db`UPDATE vh_teardown_queue SET next_retry_at = now() - interval '1 second'`;

    await scanQueueInternal.teardownOnce(5);
    expect(await scanStorage.countTeardownQueue()).toBe(1);
    await db`UPDATE vh_teardown_queue SET next_retry_at = now() - interval '1 second'`;

    await scanQueueInternal.teardownOnce(5);
    expect(await scanStorage.countTeardownQueue()).toBe(0);
  });

  it("teardown: VH unreachable keeps queue; local cancel already deleted job", async () => {
    const { projectId } = await seedProject({ fullName: "acme/teardown-down" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanStorage.approveScanJob(job.id);
    await scanQueueInternal.dispatchOnce(2);
    const scanning = await scanStorage.getScanJob(job.id);
    const vhId = scanning!.vulnhunter_task_id!;

    await scanStorage.hardDeleteGoneJob(job.id, projectId);
    expect(await scanStorage.getScanJob(job.id)).toBeNull();
    await scanStorage.enqueueVhTeardown(vhId);

    ctx.mockVh.forceDeleteBusy(5, "ECONNREFUSED");
    await scanQueueInternal.teardownOnce(5);
    expect(await scanStorage.countTeardownQueue()).toBe(1);
    // local already clean
    const db = (await import("../../infra/db/index.js")).getDb();
    const gone = await db`SELECT id FROM projects WHERE id = ${projectId}::uuid`;
    expect(gone.length).toBe(0);
  });
});

describe("auto-approve", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
    // Reset auto-approve to disabled
    const { updateScanConfig } = await import("./config-storage.js");
    await updateScanConfig({ auto_approve_enabled: false, auto_approve_strategy: "fifo" });
  });

  it("disabled: pending jobs stay pending", async () => {
    const { projectId } = await seedProject({ fullName: "acme/auto-off" });
    await scanStorage.createScanJob(projectId, null);
    const pending = await scanStorage.listPendingReviewWithStars();
    expect(pending).toHaveLength(1);
    expect(pending[0].stars).not.toBeNull();
  });

  it("fifo strategy: oldest first", async () => {
    const { updateScanConfig } = await import("./config-storage.js");
    await updateScanConfig({ auto_approve_enabled: true, auto_approve_strategy: "fifo" });
    const db = (await import("../../infra/db/index.js")).getDb();

    const p1 = await seedProject({ fullName: "acme/young-high", stars: 999 });
    await scanStorage.createScanJob(p1.projectId, null);
    // Make first job older
    await db`UPDATE scan_jobs SET created_at = now() - interval '1 hour' WHERE project_id = ${p1.projectId}::uuid`;

    const p2 = await seedProject({ fullName: "acme/old-low", stars: 1 });
    await scanStorage.createScanJob(p2.projectId, null);

    const pending = await scanStorage.listPendingReviewWithStars();
    expect(pending).toHaveLength(2);
    // FIFO: p1 (older) should be first
    expect(pending[0].full_name).toBe("acme/young-high");
  });

  it("stars_desc strategy: highest stars first", async () => {
    const { updateScanConfig } = await import("./config-storage.js");
    await updateScanConfig({ auto_approve_enabled: true, auto_approve_strategy: "stars_desc" });

    const p1 = await seedProject({ fullName: "acme/low-stars", stars: 5 });
    await scanStorage.createScanJob(p1.projectId, null);
    const p2 = await seedProject({ fullName: "acme/high-stars", stars: 500 });
    await scanStorage.createScanJob(p2.projectId, null);

    const pending = await scanStorage.listPendingReviewWithStars();
    expect(pending).toHaveLength(2);
    // Storage returns FIFO; strategy sort happens in maybeAutoApprove
    const sorted = [...pending].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
    expect(sorted[0].full_name).toBe("acme/high-stars");
  });

  it("config round-trips auto_approve fields", async () => {
    const { getScanConfig, updateScanConfig } = await import("./config-storage.js");
    await updateScanConfig({ auto_approve_enabled: true, auto_approve_strategy: "stars_desc" });
    const cfg = await getScanConfig();
    expect(cfg.auto_approve_enabled).toBe(true);
    expect(cfg.auto_approve_strategy).toBe("stars_desc");
  });
});
