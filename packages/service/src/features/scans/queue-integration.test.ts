import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupTestApp,
  cleanTables,
  seedProject,
  type TestContext,
} from "../../test/setup-db.js";
import { scanStorage, adminResyncScanJob, scanQueueInternal } from "./index.js";
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

  it("sandbox capacity failure → failed (retryable), NOT completed+0 (task-614cf34a)", async () => {
    const { projectId } = await seedProject({ fullName: "acme/sandbox-cap" });
    const job = await scanStorage.createScanJob(projectId, "cafe1234");
    await scanStorage.approveScanJob(job.id);
    await scanQueueInternal.dispatchOnce(2);
    const scanning = await scanStorage.getScanJob(job.id);
    // Exact sonic production payload shape
    ctx.mockVh.forceFailed(scanning!.vulnhunter_task_id!, {
      failureReason: JSON.stringify({
        code: "ERR_PREPARE_FAILED",
        message: "沙箱服务容量不足",
        details: {
          phase: "prepare",
          reason: "sandbox_unavailable",
          detail: "沙箱服务容量不足",
        },
      }),
      metadata: {
        prepare: { reason: "sandbox_unavailable", sandbox_type: null, project_complete: false },
      },
    });
    await scanQueueInternal.pollOnce(1);
    const failed = await scanStorage.getScanJob(job.id);
    expect(failed?.state).toBe("failed");
    expect(failed?.fail_reason_internal ?? "").toMatch(/vh_state:failed/);
    // Retry path works: failed → queued
    const retried = await scanStorage.retryScanJob(job.id);
    expect(retried?.state).toBe("queued");
    // Not marked current / no empty completion
    const proj = await (await import("../../infra/db/index.js")).getDb<
      { current: string | null }[]
    >`SELECT current_scan_job_id AS current FROM projects WHERE id = ${projectId}::uuid`;
    expect(proj[0]?.current).not.toBe(job.id);
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

describe("admin direct submissions", () => {
  let ctx: TestContext;
  const ADMIN = { authorization: "Bearer test-admin-token" };
  const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubGithub(opts?: { refOk?: boolean }) {
    const refOk = opts?.refOk ?? true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/commits/")) {
          if (!refOk) {
            return new Response(JSON.stringify({ message: "No commit found" }), {
              status: 422,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ sha: SHA }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        // repo meta
        return new Response(
          JSON.stringify({
            id: 990001,
            name: "demo-repo",
            full_name: "acme/demo-repo",
            private: false,
            html_url: "https://github.com/acme/demo-repo",
            description: "demo",
            language: "TypeScript",
            stargazers_count: 42,
            default_branch: "main",
            owner: { login: "acme" },
          }),
          { status: 200 },
        );
      }),
    );
  }

  it("creates project + queued job, skips review", async () => {
    stubGithub();
    const res = await ctx.app.request("/api/admin/submissions", {
      method: "POST",
      headers: { ...ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ repo_url: "https://github.com/acme/demo-repo" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { job_id: string; state: string; project_id: string };
    expect(body.state).toBe("queued");
    const job = await scanStorage.getScanJob(body.job_id);
    expect(job?.state).toBe("queued");
    expect(job?.commit_sha).toBe(SHA);
  });

  it("pending-reviews response includes stars/description/language", async () => {
    // Seed a pending_review job directly (listPendingReview source)
    const { projectId } = await seedProject({ fullName: "acme/review-me", stars: 777 });
    const db = (await import("../../infra/db/index.js")).getDb();
    await db`UPDATE projects SET description = 'demo desc', language = 'Go' WHERE id = ${projectId}::uuid`;
    await scanStorage.createScanJob(projectId, SHA);

    const res = await ctx.app.request("/api/admin/pending-reviews", { headers: ADMIN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        full_name: string;
        stars: number | null;
        description: string | null;
        language: string | null;
      }>;
    };
    const item = body.items.find((i) => i.full_name === "acme/review-me");
    expect(item).toBeDefined();
    expect(item?.stars).toBe(777);
    expect(item?.description).toBe("demo desc");
    expect(item?.language).toBe("Go");
  });

  it("unknown ref → 422 ref_not_found", async () => {
    stubGithub({ refOk: false });
    const res = await ctx.app.request("/api/admin/submissions", {
      method: "POST",
      headers: { ...ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ repo_url: "acme/demo-repo", git_ref: "no-such-branch" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { reason?: string } };
    expect(body.error?.reason ?? JSON.stringify(body)).toContain("ref_not_found");
  });

  it("in-flight job → 409 scan_in_progress", async () => {
    stubGithub();
    const first = await ctx.app.request("/api/admin/submissions", {
      method: "POST",
      headers: { ...ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ repo_url: "acme/demo-repo" }),
    });
    expect(first.status).toBe(201);
    const second = await ctx.app.request("/api/admin/submissions", {
      method: "POST",
      headers: { ...ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ repo_url: "acme/demo-repo" }),
    });
    expect(second.status).toBe(409);
  });

  it("same SHA completed → idempotent deduped response", async () => {
    stubGithub();
    const first = await ctx.app.request("/api/admin/submissions", {
      method: "POST",
      headers: { ...ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ repo_url: "acme/demo-repo" }),
    });
    const b1 = (await first.json()) as { job_id: string };
    // Force job to completed
    const db = (await import("../../infra/db/index.js")).getDb();
    await db`UPDATE scan_jobs SET state = 'completed', finished_at = now() WHERE id = ${b1.job_id}::uuid`;
    const second = await ctx.app.request("/api/admin/submissions", {
      method: "POST",
      headers: { ...ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ repo_url: "acme/demo-repo" }),
    });
    expect(second.status).toBe(200);
    const b2 = (await second.json()) as { deduped?: boolean; job_id: string };
    expect(b2.deduped).toBe(true);
    expect(b2.job_id).toBe(b1.job_id);
  });
});

describe("admin resync — routed by VH reality (task-28a85e46)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  async function seedFailedJob(fullName: string) {
    const { projectId } = await seedProject({ fullName });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanStorage.approveScanJob(job.id);
    await scanQueueInternal.dispatchOnce(2);
    const scanning = await scanStorage.getScanJob(job.id);
    const vhTaskId = scanning!.vulnhunter_task_id!;
    // ordinary failure → failed after grace
    ctx.mockVh.forceFailed(vhTaskId, { failureReason: "worker OOM killed" });
    await scanQueueInternal.pollOnce(1);
    const failed = await scanStorage.getScanJob(job.id);
    expect(failed?.state).toBe("failed");
    return { projectId, jobId: job.id, vhTaskId };
  }

  it("VH running → follow: failed job back to scanning, same vh_task_id", async () => {
    const { jobId, vhTaskId } = await seedFailedJob("acme/resync-follow");
    ctx.mockVh.forceState(vhTaskId, "running");
    const r = await adminResyncScanJob(jobId);
    expect(r).toMatchObject({ ok: true, action: "follow" });
    const after = await scanStorage.getScanJob(jobId);
    expect(after?.state).toBe("scanning");
    expect(after?.vulnhunter_task_id).toBe(vhTaskId); // same binding, no new VH task
    expect(after?.fail_reason_internal).toBeNull();
  });

  it("follow → VH later completes → normal harvest pipeline", async () => {
    const { jobId, projectId, vhTaskId } = await seedFailedJob("acme/resync-follow-done");
    ctx.mockVh.forceState(vhTaskId, "running");
    await adminResyncScanJob(jobId);
    // poller follows; mock auto-completes after completeAfterMs — force it now
    ctx.mockVh.forceState(vhTaskId, "completed");
    await scanQueueInternal.pollOnce(3);
    const done = await scanStorage.getScanJob(jobId);
    expect(done?.state).toBe("completed");
    expect(done?.findings_so_far).toBe(3); // mock findings harvested
    const counts = await findingsStorage.severityCounts(projectId);
    expect(counts.critical + counts.high + counts.medium).toBe(3);
  });

  it("VH completed → harvest as before (no regression)", async () => {
    const { jobId, vhTaskId } = await seedFailedJob("acme/resync-harvest");
    ctx.mockVh.forceState(vhTaskId, "completed");
    const r = await adminResyncScanJob(jobId);
    expect(r).toMatchObject({ ok: true, action: "harvest", publicCount: 3 });
    const after = await scanStorage.getScanJob(jobId);
    expect(after?.state).toBe("completed");
    expect(after?.findings_so_far).toBe(3);
  });

  it("VH still failed → explicit vh_still_failed", async () => {
    const { jobId, vhTaskId } = await seedFailedJob("acme/resync-still-failed");
    ctx.mockVh.forceFailed(vhTaskId, { failureReason: "still broken" });
    const r = await adminResyncScanJob(jobId);
    expect(r).toMatchObject({ ok: false, reason: "vh_still_failed", vhState: "failed" });
    const after = await scanStorage.getScanJob(jobId);
    expect(after?.state).toBe("failed"); // untouched
  });

  it("VH 404 → explicit vh_gone (suggest Retry/Delete at route layer)", async () => {
    const { jobId, vhTaskId } = await seedFailedJob("acme/resync-gone");
    ctx.mockVh.forceGone(vhTaskId);
    const r = await adminResyncScanJob(jobId);
    expect(r).toMatchObject({ ok: false, reason: "vh_gone" });
    const after = await scanStorage.getScanJob(jobId);
    expect(after?.state).toBe("failed"); // resync never auto-deletes
  });

  it("OV job already in flight → not_resyncable", async () => {
    const { projectId } = await seedProject({ fullName: "acme/resync-inflight" });
    const job = await scanStorage.createScanJob(projectId, null);
    await scanStorage.approveScanJob(job.id);
    await scanQueueInternal.dispatchOnce(2);
    const r = await adminResyncScanJob(job.id);
    expect(r).toMatchObject({ ok: false, reason: "not_resyncable", vhState: "scanning" });
  });

  it("VH cancelled → explicit vh_cancelled, job untouched", async () => {
    const { jobId, vhTaskId } = await seedFailedJob("acme/resync-cancelled");
    ctx.mockVh.forceState(vhTaskId, "cancelled");
    const r = await adminResyncScanJob(jobId);
    expect(r).toMatchObject({ ok: false, reason: "vh_cancelled" });
    const after = await scanStorage.getScanJob(jobId);
    expect(after?.state).toBe("failed");
  });
});
