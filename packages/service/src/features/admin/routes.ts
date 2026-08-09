import type { QueueResponse } from "@openvuln/shared";
import { type DiscloseBody, isTimestampFresh, verifyDiscloseBody } from "@openvuln/shared/crypto";
import { Hono } from "hono";
import { logger } from "../../infra/logger.js";
import { requireAdminToken } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import { findingsStorage } from "../findings/index.js";
import { projectStorage } from "../projects/index.js";
import { scanStorage } from "../scans/index.js";
import { adminResyncScanJob, setRuntimeConcurrency } from "../scans/queue.js";
import { type ImportBody, importFindingsPackage } from "./import-run.js";
import { writeAudit, listAudit } from "./audit.js";

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

// GET /api/admin/projects — paginated project list with filters
adminRouter.get("/projects", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  const perPage = Math.min(100, Math.max(1, Number(c.req.query("per_page") ?? "20")));
  const stateFilter = c.req.query("state") ?? null; // completed / scanning / etc
  const submitterFilter = c.req.query("submitter") ?? null; // login
  const search = c.req.query("q") ?? null; // project name search
  const offset = (page - 1) * perPage;

  const db = (await import("../../infra/db/index.js")).getDb();

  const baseWhere = [] as string[];
  const params = [] as unknown[];
  let paramIdx = 1;

  if (stateFilter) {
    baseWhere.push(`latest_state = $${paramIdx++}`);
    params.push(stateFilter);
  }
  if (submitterFilter) {
    baseWhere.push(`i.login = $${paramIdx++}`);
    params.push(submitterFilter);
  }
  if (search) {
    baseWhere.push(`p.full_name ILIKE $${paramIdx++}`);
    params.push(`%${search}%`);
  }

  const whereClause = baseWhere.length > 0 ? `WHERE p.removed_at IS NULL AND ${baseWhere.join(" AND ")}` : "WHERE p.removed_at IS NULL";

  const rows = await db.unsafe(
    `SELECT
      p.id::text, p.full_name, p.html_url, p.submitted_by,
      i.login AS submitter_login, i.avatar_url AS submitter_avatar,
      p.stars, p.language, p.default_branch, p.created_at,
      (SELECT s.state FROM scan_jobs s WHERE s.project_id = p.id ORDER BY s.created_at DESC LIMIT 1) AS latest_state,
      (SELECT COUNT(*) FROM scan_jobs s WHERE s.project_id = p.id) AS scan_count,
      (SELECT COUNT(*) FROM findings f WHERE f.project_id = p.id AND f.scan_job_id = p.current_scan_job_id) AS finding_count
    FROM projects p
    LEFT JOIN github_identities i ON i.user_id = p.submitted_by
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, perPage + 1, offset] as (string | number)[],
  );

  const hasMore = rows.length > perPage;
  const items = rows.slice(0, perPage);

  return c.json({
    items: items.map((r) => ({
      ...r,
      created_at: r.created_at?.toISOString?.() ?? r.created_at,
      finding_count: Number(r.finding_count ?? 0),
    })),
    page,
    per_page: perPage,
    has_more: hasMore,
  });
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
 * GET /api/admin/pending-reviews — list jobs awaiting review.
 */
adminRouter.get("/pending-reviews", async (c) => {
  const items = await scanStorage.listPendingReview();
  return c.json({
    items: items.map((j) => ({
      id: j.id,
      project_id: j.project_id,
      full_name: j.full_name,
      html_url: j.html_url,
      submitted_by: j.submitted_by,
      submitter_login: j.submitter_login,
      submitter_email: j.submitter_email,
      submitter_avatar: j.submitter_avatar,
      commit_sha: j.commit_sha,
      git_ref: j.git_ref,
      created_at: j.created_at.toISOString(),
    })),
  });
});

/**
 * POST /api/admin/scan-jobs/:id/approve — pending_review → queued.
 */
adminRouter.post("/scan-jobs/:jobId/approve", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await scanStorage.approveScanJob(jobId);
  if (!job) {
    throw new AppError("ERR_NOT_FOUND", {
      resource: "scan_job",
      reason: "not_pending_review",
    });
  }
  logger.info({ jobId: job.id }, "Admin approved scan job → queued");
  await writeAudit("approve", "scan_job", job.id, { state: job.state, project_id: job.project_id });
  return c.json({ id: job.id, state: job.state });
});

/**
 * POST /api/admin/scan-jobs/:id/reject — pending_review → rejected + email + cleanup.
 * Body optional: { reason?: string }
 */
adminRouter.post("/scan-jobs/:jobId/reject", async (c) => {
  const jobId = c.req.param("jobId");
  let reason: string | null = null;
  try {
    const body = (await c.req.json()) as { reason?: string };
    if (typeof body?.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 2000);
    }
  } catch {
    /* empty body ok */
  }
  const job = await scanStorage.rejectScanJob(jobId, reason);
  if (!job) {
    throw new AppError("ERR_NOT_FOUND", {
      resource: "scan_job",
      reason: "not_pending_review",
    });
  }

  // Send rejection email to submitter
  const { sendRejectionEmail } = await import("../notifications/mailer.js");
  const { getDb } = await import("../../infra/db/index.js");
  const db = getDb();
  const submitter = await db<
    Array<{ login: string | null; email: string | null; full_name: string }>
  >`
    SELECT i.login, i.email, p2.full_name
    FROM projects p2
    LEFT JOIN github_identities i ON i.user_id = p2.submitted_by
    WHERE p2.id = ${job.project_id}::uuid
    LIMIT 1
  `;
  const email = submitter[0]?.email;
  const fullName = submitter[0]?.full_name ?? "your project";
  if (email) {
    await sendRejectionEmail({
      to: email,
      projectName: fullName,
      reason,
    }).catch((err: unknown) =>
        logger.error({ err, jobId: job.id }, "Rejection email failed"),
      );
  }

  // Delete job + project (like VH gone cleanup)
  await db`
    DELETE FROM scan_jobs WHERE id = ${jobId}::uuid
  `;
  await db`
    DELETE FROM projects WHERE id = ${job.project_id}::uuid
  `;

  logger.info({ jobId: job.id }, "Admin rejected scan job + cleanup");
  await writeAudit("reject", "scan_job", jobId, { reason, project_id: job.project_id });
  return c.json({ id: jobId, state: "rejected" });
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
  await writeAudit("finalize", "scan_job", job.id, { state: job.state, reason });
  return c.json({
    id: job.id,
    state: job.state,
    fail_reason_internal: job.fail_reason_internal,
  });
});

/**
 * GET /api/admin/scan-config — DB-backed scan config.
 * PUT /api/admin/scan-config — update any subset of config fields.
 */
adminRouter.get("/scan-config", async (c) => {
  const { getScanConfig } = await import("../scans/config-storage.js");
  const cfg = await getScanConfig();
  return c.json(cfg);
});

adminRouter.put("/scan-config", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    throw new AppError("ERR_VALIDATION", { reason: "invalid_json" });
  }
  const { updateScanConfig } = await import("../scans/config-storage.js");
  const updates: Record<string, unknown> = {};
  const allowed = [
    "scan_timeout_hours", "max_items_per_recon", "agent_max_parallel",
    "audit_focus", "enable_dynamic_verify", "enable_dynamic_exploit",
    "scan_concurrency",
  ];
  for (const k of allowed) {
    if (k in body) updates[k] = body[k];
  }
  if (Object.keys(updates).length === 0) {
    throw new AppError("ERR_VALIDATION", { reason: "no_valid_fields" });
  }
  const cfg = await updateScanConfig(updates);
  // Apply concurrency change immediately
  if (typeof updates.scan_concurrency === "number") {
    setRuntimeConcurrency(updates.scan_concurrency);
  }
  logger.info({ updates: Object.keys(updates) }, "Admin updated scan config");
  return c.json(cfg);
});

// GET /api/admin/system-health — connectivity checks
adminRouter.get("/system-health", async (c) => {
  const config = c.get("config");
  const results: Record<string, { ok: boolean; latency_ms?: number; detail?: string }> = {};

  // VH connectivity
  try {
    const start = Date.now();
    const { getVulnHunterClient } = await import("../vulnhunter/index.js");
    const vh = getVulnHunterClient();
    const healthy = await vh.healthCheck();
    results.vulnhunter = { ok: healthy, latency_ms: Date.now() - start };
  } catch (e) {
    results.vulnhunter = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // GitHub connectivity
  try {
    const start = Date.now();
    const res = await fetch("https://api.github.com/rate_limit", {
      headers: config.github.serverToken ? { authorization: `Bearer ${config.github.serverToken}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    results.github = { ok: res.ok, latency_ms: Date.now() - start };
  } catch (e) {
    results.github = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // SMTP connectivity
  results.smtp = { ok: config.notify.emailEnabled && !!config.smtp.host };

  return c.json(results);
});

// GET /api/admin/users — list all known users
adminRouter.get("/users", async (c) => {
  const db = (await import("../../infra/db/index.js")).getDb();
  const rows = await db<
    Array<{ user_id: string; login: string; avatar_url: string | null; email: string | null; last_seen: string; project_count: number }>
  >`
    SELECT
      i.user_id::text, i.login, i.avatar_url, i.email,
      i.last_seen_at::text AS last_seen,
      COUNT(p.id) AS project_count
    FROM github_identities i
    LEFT JOIN projects p ON p.submitted_by = i.user_id
    GROUP BY i.user_id, i.login, i.avatar_url, i.email, i.last_seen_at
    ORDER BY i.last_seen_at DESC
  `;
  return c.json({ items: rows });
});

// DELETE /api/admin/projects/:id — hard delete (cascade findings + scan_jobs + artifacts)
adminRouter.delete("/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const { getDb } = await import("../../infra/db/index.js");
  const db = getDb();
  // Delete in dependency order (findings + scan_jobs have NO ACTION FK)
  await db`DELETE FROM finding_artifacts WHERE project_id = ${projectId}::uuid`;
  await db`DELETE FROM findings WHERE project_id = ${projectId}::uuid`;
  await db`DELETE FROM scan_jobs WHERE project_id = ${projectId}::uuid`;
  await db`DELETE FROM notifications WHERE payload->>'project_id' = ${projectId}`;
  const rows = await db<{ id: string }[]>`
    DELETE FROM projects WHERE id = ${projectId}::uuid RETURNING id::text
  `;
  if (rows.length === 0) throw new AppError("ERR_NOT_FOUND", { resource: "project" });
  logger.info({ projectId }, "Admin hard-deleted project");
  await writeAudit("delete_project", "project", projectId, {});
  return c.json({ ok: true });
});

// DELETE /api/admin/scan-jobs/:jobId — delete terminal scan job (failed/cancelled/rejected only)
adminRouter.delete("/scan-jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const { getDb } = await import("../../infra/db/index.js");
  const db = getDb();
  // Verify terminal state first
  const job = await db<{ id: string; project_id: string }[]>`
    SELECT id::text, project_id::text FROM scan_jobs
    WHERE id = ${jobId}::uuid AND state IN ('failed', 'cancelled', 'rejected')
  `;
  if (job.length === 0) throw new AppError("ERR_CONFLICT", { reason: "not_deletable", message: "Only failed/cancelled/rejected jobs can be deleted" });
  // Cascade: artifacts → findings → job
  await db`DELETE FROM finding_artifacts WHERE finding_id IN (SELECT id FROM findings WHERE scan_job_id = ${jobId}::uuid)`;
  await db`DELETE FROM findings WHERE scan_job_id = ${jobId}::uuid`;
  await db`DELETE FROM scan_jobs WHERE id = ${jobId}::uuid`;
  logger.info({ jobId }, "Admin deleted terminal scan job");
  await writeAudit("delete_scan_job", "scan_job", jobId, { project_id: job[0].project_id });
  return c.json({ ok: true });
});

// GET /api/admin/projects/:id — project detail with scan history
adminRouter.get("/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const { getDb } = await import("../../infra/db/index.js");
  const db = getDb();

  const project = await db<
    Array<{ id: string; full_name: string; html_url: string; submitted_by: number | null; login: string | null; avatar_url: string | null; stars: number; language: string | null; default_branch: string; created_at: Date }>
  >`
    SELECT p.id::text, p.full_name, p.html_url, p.submitted_by,
           i.login, i.avatar_url, p.stars, p.language, p.default_branch, p.created_at
    FROM projects p
    LEFT JOIN github_identities i ON i.user_id = p.submitted_by
    WHERE p.id = ${projectId}::uuid
  `;
  if (project.length === 0) throw new AppError("ERR_NOT_FOUND", { resource: "project" });

  const scans = await db<
    Array<{ id: string; state: string; commit_sha: string | null; git_ref: string | null; findings_so_far: number; created_at: Date; started_at: Date | null; finished_at: Date | null; finding_count: number; fail_reason: string | null }>
  >`
    SELECT
      s.id::text, s.state, s.commit_sha, s.git_ref,
      COALESCE(s.findings_so_far, 0) AS findings_so_far,
      s.created_at, s.started_at, s.finished_at,
      (SELECT count(*) FROM findings f WHERE f.scan_job_id = s.id) AS finding_count,
      s.fail_reason_internal AS fail_reason
    FROM scan_jobs s
    WHERE s.project_id = ${projectId}::uuid
    ORDER BY s.created_at DESC
  `;

  return c.json({
    ...project[0],
    created_at: project[0].created_at.toISOString(),
    scans: scans.map((s) => ({
      ...s,
      created_at: s.created_at.toISOString(),
      started_at: s.started_at?.toISOString() ?? null,
      finished_at: s.finished_at?.toISOString() ?? null,
      finding_count: Number(s.finding_count),
    })),
  });
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
  await writeAudit("undisclose", "finding", findingId, {});
  return c.json({ ok: true, finding_id: findingId });
});

// POST /api/admin/scan-jobs/:id/set-current — set project.current_scan_job_id to this completed job
adminRouter.post("/scan-jobs/:jobId/set-current", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await scanStorage.getScanJob(jobId);
  if (!job) throw new AppError("ERR_NOT_FOUND", { resource: "scan_job" });
  if (job.state !== "completed") {
    throw new AppError("ERR_CONFLICT", { reason: "not_completed", state: job.state });
  }
  await scanStorage.setCurrentScanJob(job.project_id, jobId);
  await writeAudit("set_current", "scan_job", jobId, { project_id: job.project_id });
  return c.json({ ok: true, project_id: job.project_id, current_scan_job_id: jobId });
});

// GET /api/admin/scan-jobs/:id/findings — findings for a specific scan version
adminRouter.get("/scan-jobs/:jobId/findings", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await scanStorage.getScanJob(jobId);
  if (!job) throw new AppError("ERR_NOT_FOUND", { resource: "scan_job" });
  const findings = await findingsStorage.listAllForOwner(job.project_id, jobId);
  return c.json({
    job_id: jobId,
    project_id: job.project_id,
    state: job.state,
    findings: findings.map((f) => ({
      id: f.id,
      finding_key: f.finding_key,
      severity: f.severity,
      title: f.title,
      cwe: f.cwe,
      primary_file: f.primary_file,
      disclosure_state: f.disclosure_state,
      cvss_score: f.cvss_score,
      poc_status: f.poc_status,
    })),
  });
});

// GET /api/admin/search — search jobs by vh_task_id / commit / project name
adminRouter.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q || q.length < 2) {
    throw new AppError("ERR_VALIDATION", { field: "q", reason: "min_2_chars" });
  }
  const db = (await import("../../infra/db/index.js")).getDb();
  const like = `%${q}%`;
  const jobs = await db`
    SELECT
      j.id::text, j.project_id::text, j.state, j.commit_sha, j.git_ref,
      j.vulnhunter_task_id::text, j.created_at,
      p.full_name
    FROM scan_jobs j
    JOIN projects p ON p.id = j.project_id
    WHERE j.vulnhunter_task_id::text ILIKE ${like}
       OR j.commit_sha ILIKE ${like}
       OR p.full_name ILIKE ${like}
       OR j.id::text ILIKE ${like}
    ORDER BY j.created_at DESC
    LIMIT 50
  `;
  return c.json({
    items: jobs.map((j: any) => ({
      ...j,
      created_at: j.created_at?.toISOString?.() ?? j.created_at,
    })),
  });
});

// POST /api/admin/batch — batch operations
// Body: { action: "approve"|"reject"|"delete_jobs"|"delete_projects"|"finalize", ids: string[], reason?: string }
adminRouter.post("/batch", async (c) => {
  let body: { action?: string; ids?: string[]; reason?: string };
  try {
    body = (await c.req.json()) as { action?: string; ids?: string[]; reason?: string };
  } catch {
    throw new AppError("ERR_VALIDATION", { reason: "invalid_json" });
  }
  const action = body.action;
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : [];
  if (!action || ids.length === 0) {
    throw new AppError("ERR_VALIDATION", { reason: "action_and_ids_required" });
  }
  if (ids.length > 50) {
    throw new AppError("ERR_VALIDATION", { reason: "max_50_ids" });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  const db = (await import("../../infra/db/index.js")).getDb();

  for (const id of ids) {
    try {
      if (action === "approve") {
        const job = await scanStorage.approveScanJob(id);
        if (!job) throw new Error("not_pending_review");
        await writeAudit("batch_approve", "scan_job", id, {});
        results.push({ id, ok: true });
      } else if (action === "reject") {
        const job = await scanStorage.rejectScanJob(id, body.reason ?? null);
        if (!job) throw new Error("not_pending_review");
        await db`DELETE FROM scan_jobs WHERE id = ${id}::uuid`;
        await db`DELETE FROM projects WHERE id = ${job.project_id}::uuid
          AND NOT EXISTS (SELECT 1 FROM scan_jobs WHERE project_id = ${job.project_id}::uuid)`;
        await writeAudit("batch_reject", "scan_job", id, { reason: body.reason ?? null });
        results.push({ id, ok: true });
      } else if (action === "delete_jobs") {
        const job = await db<{ id: string }[]>`
          SELECT id::text FROM scan_jobs
          WHERE id = ${id}::uuid AND state IN ('failed', 'cancelled', 'rejected')
        `;
        if (job.length === 0) throw new Error("not_deletable");
        await db`DELETE FROM finding_artifacts WHERE finding_id IN (SELECT id FROM findings WHERE scan_job_id = ${id}::uuid)`;
        await db`DELETE FROM findings WHERE scan_job_id = ${id}::uuid`;
        await db`DELETE FROM scan_jobs WHERE id = ${id}::uuid`;
        await writeAudit("batch_delete_job", "scan_job", id, {});
        results.push({ id, ok: true });
      } else if (action === "delete_projects") {
        await db`DELETE FROM finding_artifacts WHERE project_id = ${id}::uuid`;
        await db`DELETE FROM findings WHERE project_id = ${id}::uuid`;
        await db`DELETE FROM scan_jobs WHERE project_id = ${id}::uuid`;
        await db`DELETE FROM notifications WHERE payload->>'project_id' = ${id}`;
        const rows = await db`DELETE FROM projects WHERE id = ${id}::uuid RETURNING id::text`;
        if (rows.length === 0) throw new Error("not_found");
        await writeAudit("batch_delete_project", "project", id, {});
        results.push({ id, ok: true });
      } else if (action === "finalize") {
        const job = await scanStorage.finalizeInFlight(id, body.reason ?? "batch_finalize");
        if (!job) throw new Error("not_in_flight");
        await writeAudit("batch_finalize", "scan_job", id, {});
        results.push({ id, ok: true });
      } else {
        throw new Error(`unknown_action:${action}`);
      }
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  await writeAudit("batch", "batch", null, { action, count: ids.length, ok: results.filter((r) => r.ok).length });
  return c.json({ results });
});

// GET /api/admin/audit-log
adminRouter.get("/audit-log", async (c) => {
  const page = Number(c.req.query("page") ?? "1");
  const perPage = Number(c.req.query("per_page") ?? "50");
  const action = c.req.query("action") ?? null;
  const targetType = c.req.query("target_type") ?? null;
  const result = await listAudit({ page, perPage, action, targetType });
  return c.json(result);
});

