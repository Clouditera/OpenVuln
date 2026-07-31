import { Hono } from "hono";
import type { QueueResponse } from "@openvuln/shared";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import * as scanStorage from "../scans/storage.js";
import * as projectStorage from "../projects/storage.js";

export const adminRouter = new Hono();

adminRouter.use("*", requireAuth);
adminRouter.use("*", requireAdmin);

// GET /api/admin/queue
adminRouter.get("/queue", async (c) => {
  const items = await scanStorage.listQueue();
  const body: QueueResponse = {
    items: items.map((j) => ({
      id: j.id,
      project_id: j.project_id,
      project_full_name: j.project_full_name,
      state: j.state,
      vulnhunter_task_id: j.vulnhunter_task_id,
      attempt: j.attempt,
      fail_reason_internal: j.fail_reason_internal,
      created_at: j.created_at.toISOString(),
      started_at: j.started_at?.toISOString() ?? null,
      finished_at: j.finished_at?.toISOString() ?? null,
    })),
  };
  return c.json(body);
});

// POST /api/admin/scan-jobs/:id/retry
adminRouter.post("/scan-jobs/:jobId/retry", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await scanStorage.retryScanJob(jobId);
  if (!job) throw new AppError("ERR_NOT_FOUND", { resource: "scan_job", reason: "not_failed_or_missing" });
  return c.json({
    id: job.id,
    state: job.state,
    attempt: job.attempt,
  });
});

// DELETE /api/admin/projects/:id  (soft delete)
adminRouter.delete("/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const ok = await projectStorage.softDelete(projectId);
  if (!ok) throw new AppError("ERR_NOT_FOUND", { resource: "project" });
  return c.json({ ok: true });
});
