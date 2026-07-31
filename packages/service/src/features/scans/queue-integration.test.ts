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

  it("dispatch → poll → findings cached", async () => {
    const { projectId } = await seedProject({ fullName: "acme/scan-me" });
    const job = await scanStorage.createScanJob(projectId, "deadbeef");
    expect(job.state).toBe("queued");

    await scanQueueInternal.dispatchOnce(2);

    const afterDispatch = await scanStorage.getScanJob(job.id);
    expect(afterDispatch?.state).toBe("scanning");
    expect(afterDispatch?.vulnhunter_task_id).toBeTruthy();

    // Force mock VH task completed
    ctx.mockVh.forceState(afterDispatch!.vulnhunter_task_id!, "completed");

    await scanQueueInternal.pollOnce();

    const done = await scanStorage.getScanJob(job.id);
    expect(done?.state).toBe("completed");

    const findings = await findingsStorage.listForOwner(projectId);
    expect(findings.length).toBe(2);
    expect(findings.every((f) => f.disclosure_state === "owner_only")).toBe(true);

    const counts = await findingsStorage.severityCounts(projectId);
    expect(counts.high + counts.medium + counts.low + counts.info).toBe(2);
  });

  it("respects concurrency slots", async () => {
    const a = await seedProject({ fullName: "acme/a" });
    const b = await seedProject({ fullName: "acme/b" });
    await scanStorage.createScanJob(a.projectId, null);
    await scanStorage.createScanJob(b.projectId, null);

    await scanQueueInternal.dispatchOnce(1);
    const inFlight = await scanStorage.countInFlight();
    expect(inFlight).toBe(1);

    const queue = await scanStorage.listQueue();
    const scanning = queue.filter((j) => j.state === "scanning" || j.state === "dispatching");
    const queued = queue.filter((j) => j.state === "queued");
    expect(scanning.length).toBe(1);
    expect(queued.length).toBe(1);
  });
});
