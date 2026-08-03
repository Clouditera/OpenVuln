import type { QueueResponse } from "@openvuln/shared";
import { type DiscloseBody, isTimestampFresh, verifyDiscloseBody } from "@openvuln/shared/crypto";
import { Hono } from "hono";
import { logger } from "../../infra/logger.js";
import { requireAdminToken } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import { findingsStorage } from "../findings/index.js";
import { projectStorage } from "../projects/index.js";
import { scanStorage } from "../scans/index.js";
import { adminResyncScanJob, getScanConfigView, setRuntimeConcurrency } from "../scans/queue.js";
import { type ImportBody, importFindingsPackage } from "./import-run.js";

export const adminRouter = new Hono();

adminRouter.use("*", requireAdminToken);

/**
 * POST /api/admin/import — offline shelf (path B).
 * Body: { repo?, project_id?, commit_sha?, findings: [...] }
 * Plaintext import; creates completed scan_job.
 */
adminRouter.post("/import", async (c) => {
  let body: ImportBody;
  try {
    body = (await c.req.json()) as ImportBody;
  } catch {
    throw new AppError("ERR_VALIDATION", { reason: "invalid_json" });
  }
  try {
    const result = await importFindingsPackage(body);
    logger.info(
      {
        projectId: result.project_id,
        imported: result.imported,
        skipped: result.skipped,
      },
      "admin offline import",
    );
    return c.json(result, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("required") || msg.includes("invalid")) {
      throw new AppError("ERR_VALIDATION", { reason: msg });
    }
    logger.error({ err }, "admin import failed");
    throw new AppError("ERR_INTERNAL", { reason: msg.slice(0, 500) });
  }
});

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
  if (!job) {
    throw new AppError("ERR_NOT_FOUND", {
      resource: "scan_job",
      reason: "not_failed_or_missing",
    });
  }
  return c.json({
    id: job.id,
    state: job.state,
    attempt: job.attempt,
  });
});

/**
 * POST /api/admin/scan-jobs/:id/resync
 * Manual recovery: failed OV job whose VH task is already completed → full sync.
 * 409 if VH is not completed (reports real VH state).
 */
adminRouter.post("/scan-jobs/:jobId/resync", async (c) => {
  const jobId = c.req.param("jobId");
  const result = await adminResyncScanJob(jobId);
  if (!result.ok) {
    if (result.reason === "not_found") {
      throw new AppError("ERR_NOT_FOUND", { resource: "scan_job" });
    }
    if (result.reason === "vh_not_completed" || result.reason === "not_failed") {
      throw new AppError("ERR_CONFLICT", {
        reason: result.reason,
        vh_state: result.vhState ?? null,
      });
    }
    throw new AppError("ERR_INTERNAL", { reason: result.reason });
  }
  return c.json({ ok: true, public_count: result.publicCount });
});

/**
 * POST /api/admin/scan-jobs/:id/finalize
 * Escape hatch: scanning|dispatching → failed (does not delete rows).
 * Body optional: { reason?: string }
 */
adminRouter.post("/scan-jobs/:jobId/finalize", async (c) => {
  const jobId = c.req.param("jobId");
  let reason = "admin_finalize";
  try {
    const body = (await c.req.json()) as { reason?: string };
    if (typeof body?.reason === "string" && body.reason.trim()) {
      reason = `admin_finalize:${body.reason.trim().slice(0, 200)}`;
    }
  } catch {
    /* empty body ok */
  }
  const job = await scanStorage.finalizeInFlight(jobId, reason);
  if (!job) {
    const existing = await scanStorage.getScanJob(jobId);
    if (!existing) throw new AppError("ERR_NOT_FOUND", { resource: "scan_job" });
    throw new AppError("ERR_CONFLICT", {
      reason: "not_in_flight",
      state: existing.state,
    });
  }
  return c.json({
    id: job.id,
    state: job.state,
    fail_reason_internal: job.fail_reason_internal,
  });
});

/**
 * GET /api/admin/scan-config — current concurrency + source (override|env).
 * PUT /api/admin/scan-config {concurrency:1..16} — memory override (restart clears).
 */
adminRouter.get("/scan-config", async (c) => {
  const config = c.get("config");
  return c.json(getScanConfigView(config.scan.concurrency));
});

adminRouter.put("/scan-config", async (c) => {
  let body: { concurrency?: number | null };
  try {
    body = (await c.req.json()) as { concurrency?: number | null };
  } catch {
    throw new AppError("ERR_VALIDATION", { reason: "invalid_json" });
  }
  if (body.concurrency === null) {
    const n = setRuntimeConcurrency(null);
    return c.json({ concurrency: n, source: "env" as const });
  }
  if (typeof body.concurrency !== "number" || !Number.isFinite(body.concurrency)) {
    throw new AppError("ERR_VALIDATION", { field: "concurrency" });
  }
  const n = setRuntimeConcurrency(body.concurrency);
  return c.json({ concurrency: n, source: "override" as const });
});

// DELETE /api/admin/projects/:id
adminRouter.delete("/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const ok = await projectStorage.softDelete(projectId);
  if (!ok) throw new AppError("ERR_NOT_FOUND", { resource: "project" });
  return c.json({ ok: true });
});

// GET /api/admin/projects/:id/report-package — plaintext package (legacy path kept)
adminRouter.get("/projects/:projectId/report-package", async (c) => {
  const projectId = c.req.param("projectId");
  if (!findingsStorage.isUuid(projectId)) {
    throw new AppError("ERR_VALIDATION", { field: "projectId" });
  }
  const project = await projectStorage.findById(projectId);
  if (!project) throw new AppError("ERR_NOT_FOUND", { resource: "project" });

  const latest = await scanStorage.getLatestScanForProject(projectId);
  const items = await findingsStorage.listAllForOwner(projectId);
  const { listArtifactsForProject } = await import("../findings/artifacts-storage.js");
  const artifacts = await listArtifactsForProject(projectId);

  const body = {
    generated_at: new Date().toISOString(),
    project: {
      id: project.id,
      full_name: project.full_name,
      html_url: project.html_url,
      default_branch: project.default_branch,
    },
    scan_job: latest
      ? {
          id: latest.id,
          state: latest.state,
          commit_sha: latest.commit_sha,
          finished_at: latest.finished_at?.toISOString() ?? null,
        }
      : null,
    items,
    artifacts,
  };

  const filename = `openvuln-${project.full_name.replace(/[^A-Za-z0-9._-]+/g, "-")}-package.json`;
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});

// Legacy signed disclose kept for migration window (optional if key present)
adminRouter.post("/projects/:projectId/disclose", async (c) => {
  const projectId = c.req.param("projectId");
  const config = c.get("config");
  if (!config.adminPublicKeyPem) {
    throw new AppError("ERR_FORBIDDEN", {
      reason: "signed_disclose_retired",
      message: "Use owner POST /api/projects/:id/disclose or admin undisclose",
    });
  }

  const sig = c.req.header("x-ov-signature") ?? "";
  if (!sig) {
    throw new AppError("ERR_UNAUTHORIZED", { reason: "missing_signature" });
  }

  let body: DiscloseBody;
  try {
    body = (await c.req.json()) as DiscloseBody;
  } catch {
    throw new AppError("ERR_VALIDATION", { reason: "invalid_json" });
  }

  if (body.action !== "disclose") {
    throw new AppError("ERR_VALIDATION", { field: "action" });
  }
  if (body.project_id !== projectId) {
    throw new AppError("ERR_VALIDATION", {
      field: "project_id",
      reason: "mismatch_path",
    });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new AppError("ERR_VALIDATION", { field: "items" });
  }
  if (typeof body.timestamp !== "number" || !body.nonce) {
    throw new AppError("ERR_VALIDATION", { fields: ["timestamp", "nonce"] });
  }
  if (!isTimestampFresh(body.timestamp)) {
    throw new AppError("ERR_VALIDATION", { reason: "timestamp_out_of_window" });
  }

  const okSig = verifyDiscloseBody(config.adminPublicKeyPem, body, sig);
  if (!okSig) {
    throw new AppError("ERR_UNAUTHORIZED", { reason: "bad_signature" });
  }

  const nonceOk = await findingsStorage.consumeNonce(body.nonce);
  if (!nonceOk) {
    throw new AppError("ERR_CONFLICT", { reason: "nonce_replay" });
  }

  const project = await projectStorage.findById(projectId);
  if (!project) throw new AppError("ERR_NOT_FOUND", { resource: "project" });

  const updated = await findingsStorage.applyDisclose(
    projectId,
    body.items.map((it) => ({
      finding_id: it.finding_id,
      title: it.title,
      cwe: it.cwe,
      summary: it.summary,
      report_yaml: it.report_yaml,
      files: it.files,
    })),
  );

  if (updated.length === 0) {
    throw new AppError("ERR_NOT_FOUND", {
      resource: "finding",
      reason: "none_matched_project",
    });
  }

  logger.info(
    {
      projectId,
      count: updated.length,
      noncePrefix: body.nonce.slice(0, 8),
    },
    "admin disclose applied",
  );

  return c.json({ disclosed_count: updated.length, finding_ids: updated });
});

/** Ops fallback: reverse accidental owner disclose (token only). */
adminRouter.post("/findings/:findingId/undisclose", async (c) => {
  const findingId = c.req.param("findingId");
  if (!findingsStorage.isUuid(findingId)) {
    throw new AppError("ERR_VALIDATION", { field: "findingId" });
  }
  const db = (await import("../../infra/db/index.js")).getDb();
  const rows = await db`
    UPDATE findings
    SET disclosure_state = 'owner_only',
        disclosed_at = NULL
    WHERE id = ${findingId}::uuid
      AND disclosure_state = 'disclosed'
    RETURNING id::text
  `;
  if (rows.length === 0) {
    throw new AppError("ERR_NOT_FOUND", { resource: "finding", reason: "not_disclosed" });
  }
  return c.json({ ok: true, finding_id: findingId });
});
