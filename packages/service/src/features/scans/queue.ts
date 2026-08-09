import { randomUUID } from "node:crypto";
import { type SeverityStored, isIngestiblePocStatus, severityFromCvss } from "@openvuln/shared";
import type { ServiceConfig } from "../../infra/config.js";
import { loadConfig } from "../../infra/config.js";
import { getDb } from "../../infra/db/index.js";
import { logger } from "../../infra/logger.js";
import { findingsStorage, harvestFindingArtifacts } from "../findings/index.js";
import { githubApi, githubZipball, parseGitHubUrl } from "../projects/index.js";
import {
  type VhFindingMeta,
  getVulnHunterClient,
  isVhTaskGoneError,
} from "../vulnhunter/index.js";
import * as storage from "./storage.js";

const KNOWN_VH_ACTIVE = new Set([
  "running",
  "preparing",
  "queued",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * VH "no audit value" failures → treat as completed empty scan (Scanned + 0 findings).
 * Keywords + metadata flags; env VH_NO_VALUE_FAIL_PATTERNS=comma|separated|extra
 */
export function isNoScanValueFailure(
  failureReason: string | null | undefined,
  metadata?: Record<string, unknown> | null,
): boolean {
  const meta = metadata ?? {};
  if (meta.source_incomplete === true) return true;
  const prep = meta.prepare;
  if (prep && typeof prep === "object" && !Array.isArray(prep)) {
    const reason = String((prep as Record<string, unknown>).reason ?? "");
    if (reason === "partial_source" || reason === "incomplete_source") return true;
    if ((prep as Record<string, unknown>).project_complete === false) return true;
  }
  const text = (failureReason ?? "").toLowerCase();
  if (!text) return false;
  const defaults = [
    "源码不完整",
    "功能代码缺失",
    "无法建立完整的代码功能语义",
    "partial_source",
    "incomplete source",
    "no scannable",
  ];
  const extra = (process.env.VH_NO_VALUE_FAIL_PATTERNS ?? "")
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const p of [...defaults, ...extra]) {
    if (p && text.includes(p.toLowerCase())) return true;
  }
  return false;
}

/** Mark job completed with zero findings (empty public result). */
async function markCompletedEmpty(jobId: string, projectId: string, reason: string): Promise<void> {
  const db = getDb();
  const { emptySeverityCounts } = await import("@openvuln/shared");
  const { notificationStorage } = await import("../notifications/index.js");
  await db.begin(async (tx) => {
    await storage.updateFindingsSoFar(jobId, 0, tx);
    await storage.setCurrentScanJob(projectId, jobId, tx);
    await storage.markCompleted(jobId, tx);
    await tx`
      UPDATE scan_jobs
      SET fail_reason_internal = ${reason.slice(0, 2000)}
      WHERE id = ${jobId}::uuid
    `;
    await notificationStorage.insertScanCompleted(tx, {
      jobId,
      projectId,
      counts: emptySeverityCounts(),
      noValue: true,
    });
  });
}

let dispatcherTimer: ReturnType<typeof setInterval> | null = null;
let pollerTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Tick re-entrancy guards. */
let dispatchBusy = false;
let pollBusy = false;

/** Runtime concurrency override (admin PUT); null → env default. */
let runtimeConcurrency: number | null = null;

/** VH outage backoff state. */
let vhOutageStrikes = 0;
let pollNotBefore = 0;
let dispatchNotBefore = 0;

const DISPATCH_MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 300_000;

function pickNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function isTransientVhError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message.toLowerCase();
  if (msg.includes("abort") || msg.includes("timeout")) return true;
  if (msg.includes("fetch failed") || msg.includes("econn") || msg.includes("enotfound")) {
    return true;
  }
  // HTTP 5xx from client wrappers
  if (/\b5\d\d\b/.test(msg)) return true;
  if (msg.includes("network")) return true;
  return false;
}

function nextBackoffMs(strikes: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, strikes - 1));
  return exp;
}

function noteVhSuccess(): void {
  if (vhOutageStrikes > 0) {
    logger.info({ previousStrikes: vhOutageStrikes }, "VH reachable again — backoff cleared");
  }
  vhOutageStrikes = 0;
  pollNotBefore = 0;
  dispatchNotBefore = 0;
}

function noteVhOutage(scope: "poll" | "dispatch"): void {
  vhOutageStrikes += 1;
  const delay = nextBackoffMs(vhOutageStrikes);
  const until = Date.now() + delay;
  if (scope === "poll") pollNotBefore = until;
  else dispatchNotBefore = until;
  // keep both in sync so neither thrashes during full outage
  pollNotBefore = Math.max(pollNotBefore, until);
  dispatchNotBefore = Math.max(dispatchNotBefore, until);
  logger.warn(
    { strikes: vhOutageStrikes, backoffMs: delay, scope },
    "VH unreachable — backing off",
  );
}

/** Map VH meta/detail → NVD display severity + CVSS fields. */
export function mapFindingSeverity(
  meta: VhFindingMeta,
  detail: unknown,
): {
  severity: SeverityStored;
  cvssScore: number | null;
  cvssVector: string | null;
  vhSeverity: string | null;
} {
  const detailObj = (detail && typeof detail === "object" ? detail : {}) as Record<string, unknown>;
  const metaRec = meta as Record<string, unknown>;
  const cvssScore = pickNumber(
    meta.cvss_score,
    metaRec.cvssScore,
    detailObj.cvss_score,
    detailObj.cvssScore,
    (detailObj.metadata as Record<string, unknown> | undefined)?.cvss_score,
  );
  const cvssVector = pickString(
    meta.cvss_vector,
    metaRec.cvssVector,
    detailObj.cvss_vector,
    detailObj.cvssVector,
    (detailObj.metadata as Record<string, unknown> | undefined)?.cvss_vector,
  );
  const vhSeverity = pickString(
    meta.severity,
    detailObj.severity,
    (detailObj.metadata as Record<string, unknown> | undefined)?.severity,
  );

  let severity: SeverityStored;
  if (cvssScore != null) {
    severity = severityFromCvss(cvssScore);
  } else if (vhSeverity) {
    const s = vhSeverity.toLowerCase();
    if (s === "critical" || s === "高危" || s === "严重") severity = "critical";
    else if (s === "high" || s === "高") severity = "high";
    else if (s === "medium" || s === "中" || s === "中危") severity = "medium";
    else if (s === "low" || s === "低" || s === "低危") severity = "low";
    else severity = "info";
  } else {
    severity = "info";
  }

  return { severity, cvssScore, cvssVector, vhSeverity };
}

export function shouldIngestFinding(meta: VhFindingMeta, detail: unknown): boolean {
  const detailObj = (detail && typeof detail === "object" ? detail : {}) as Record<string, unknown>;
  const itemType = (
    pickString(meta.item_type, detailObj.item_type, detailObj.itemType) ?? "finding"
  ).toLowerCase();
  if (itemType !== "finding") return false;

  const poc = pickString(meta.poc_status, detailObj.poc_status, detailObj.pocStatus);
  // missing poc_status → unknown → ingest
  if (poc && !isIngestiblePocStatus(poc)) return false;
  return true;
}

async function getProjectMeta(projectId: string): Promise<{
  full_name: string;
  html_url: string;
  owner_login: string;
  name: string;
  default_branch: string;
} | null> {
  const db = getDb();
  const rows = await db<
    {
      full_name: string;
      html_url: string;
      owner_login: string;
      name: string;
      default_branch: string;
    }[]
  >`
    SELECT full_name, html_url, owner_login, name, default_branch
    FROM projects WHERE id = ${projectId}::uuid
  `;
  return rows[0] ?? null;
}

export function getEffectiveConcurrency(envDefault: number): number {
  return runtimeConcurrency ?? envDefault;
}

export function getScanConfigView(envDefault: number): {
  concurrency: number;
  source: "override" | "env";
  vh_fail_grace_polls: number;
} {
  const cfg = loadConfig();
  return {
    concurrency: getEffectiveConcurrency(envDefault),
    source: runtimeConcurrency != null ? "override" : "env",
    vh_fail_grace_polls: cfg.scan.vhFailGracePolls,
  };
}

/** Admin runtime override. Clamped 1..16. null clears override. */
export function setRuntimeConcurrency(n: number | null): number {
  if (n == null) {
    runtimeConcurrency = null;
    return loadConfig().scan.concurrency;
  }
  const v = Math.max(1, Math.min(16, Math.floor(n)));
  runtimeConcurrency = v;
  return v;
}

async function reapStaleDispatching(staleMinutes: number): Promise<void> {
  const stale = await storage.listStaleDispatching(staleMinutes);
  for (const job of stale) {
    if (job.attempt + 1 < DISPATCH_MAX_ATTEMPTS) {
      await storage.requeueDispatching(job.id, "dispatch_stale");
      logger.warn(
        { jobId: job.id, attempt: job.attempt + 1, staleMinutes },
        "Stale dispatching job requeued",
      );
    } else {
      await storage.markFailed(job.id, "dispatch_stale");
      logger.warn({ jobId: job.id }, "Stale dispatching job failed (max attempts)");
    }
  }
}

async function dispatchOnce(concurrency: number): Promise<void> {
  if (Date.now() < dispatchNotBefore) return;

  const cfg = loadConfig();
  await reapStaleDispatching(cfg.scan.dispatchStaleMinutes);

  const inFlight = await storage.countInFlight();
  const slots = concurrency - inFlight;
  if (slots <= 0) return;

  const jobs = await storage.claimQueuedJobs(slots);
  if (jobs.length === 0) return;

  const vh = getVulnHunterClient();
  let allFailedTransient = true;
  let attempted = 0;

  for (const job of jobs) {
    const project = await getProjectMeta(job.project_id);
    if (!project) {
      await storage.markFailed(job.id, "project_missing");
      continue;
    }
    // VH display_name: Han/A-Za-z0-9/_/-/() only, max 64 (task-name.ts post-upgrade).
    const shortId = job.id.slice(0, 8);
    const attemptSuffix = job.attempt > 1 ? `-a${job.attempt}` : "";
    const tail = `-${shortId}${attemptSuffix}`;
    const safeRepo = `${project.owner_login}-${project.name}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
    const maxRepo = Math.max(1, 64 - tail.length);
    const displayName = `${safeRepo.slice(0, maxRepo)}${tail}`;
    attempted += 1;
    try {
      logger.info({ jobId: job.id, project: project.full_name }, "Dispatching scan job to VH");
      // Load DB-backed scan config (falls back to env defaults if DB unavailable)
      let dbConfig = null as null | {
        scan_timeout_hours: number;
        max_items_per_recon: number;
        agent_max_parallel: number;
        audit_focus: string | null;
        output_language: string;
        vuln_focus: string | null;
        enable_dynamic_verify: boolean;
        enable_dynamic_exploit: boolean;
      };
      try {
        const { getScanConfig } = await import("./config-storage.js");
        dbConfig = await getScanConfig();
      } catch {
        // DB not ready or table missing — use env config
      }
      const cfg = loadConfig();
      const envC = cfg.vulnhunter.create;
      const timeoutHours = dbConfig?.scan_timeout_hours ?? envC.scanTimeoutHours;
      // VH custom mode: 1800s (30min) .. 259200s (72h)
      const scanTimeoutSeconds = Math.min(
        259_200,
        Math.max(1_800, Math.round(Number(timeoutHours) * 3600)),
      );
      const createOpts = {
        displayName,
        scanTimeoutSeconds,
        timeoutMode: "custom" as const,
        maxItemsPerRecon: dbConfig?.max_items_per_recon ?? envC.maxItemsPerRecon,
        agentMaxParallel: dbConfig?.agent_max_parallel ?? envC.agentMaxParallel,
        auditFocus: dbConfig?.audit_focus ?? envC.auditFocus,
        outputLanguage: dbConfig?.output_language ?? "en",
        vulnFocus: dbConfig?.vuln_focus ?? undefined,
        enableDynamicVerify: dbConfig?.enable_dynamic_verify ?? envC.enableDynamicVerify,
        enableDynamicExploit: dbConfig?.enable_dynamic_exploit ?? envC.enableDynamicExploit,
      };

      let taskId: string;

      // Mock never hits real GitHub/VH upload; archive mode is for real TOKEN/cookie clients.
      if (cfg.vulnhunter.sourceMode === "archive") {
        // Use stored commit_sha (locked at submit time) — don't re-fetch HEAD
        const parsed =
          parseGitHubUrl(project.html_url) ??
          ({ owner: project.owner_login, repo: project.name } as const);
        let sha = job.commit_sha;
        if (!sha) {
          // Fallback for legacy jobs without commit_sha
          sha = await githubApi.fetchDefaultBranchHeadSha(
            parsed.owner,
            parsed.repo,
            project.default_branch || "main",
            cfg.github.serverToken || undefined,
          );
          if (sha) await storage.setCommitSha(job.id, sha);
        }
        const refSha = sha ?? project.default_branch ?? "main";

        const maxBytes = Math.max(1, cfg.vulnhunter.zipMaxMb) * 1024 * 1024;
        try {
          const zip = await githubZipball.downloadGithubZipball({
            owner: parsed.owner,
            repo: parsed.repo,
            ref: refSha,
            maxBytes,
            token: cfg.github.serverToken || undefined,
            timeoutMs: cfg.vulnhunter.zipDownloadTimeoutMs,
          });
          ({ taskId } = await vh.createScanTaskFromArchive({
            ...createOpts,
            archive: zip.buffer,
            filename: zip.filename,
          }));
        } catch (zerr) {
          if (zerr instanceof githubZipball.ZipballTooLargeError) {
            await storage.markFailed(job.id, zerr.message.slice(0, 2000));
            allFailedTransient = false;
            continue;
          }
          throw zerr;
        }
      } else {
        ({ taskId } = await vh.createScanTask({
          ...createOpts,
          gitUrl: project.html_url,
        }));
      }

      await storage.markScanning(job.id, taskId);
      logger.info({ jobId: job.id, vhTaskId: taskId }, "Scan job dispatched");
      allFailedTransient = false;
      noteVhSuccess();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobId: job.id }, "Failed to dispatch scan job");
      const transient = isTransientVhError(err);
      if (!transient) allFailedTransient = false;
      // attempt is current claim count; requeue if under max
      if (job.attempt + 1 < DISPATCH_MAX_ATTEMPTS) {
        await storage.requeueDispatching(job.id, reason);
        logger.warn(
          { jobId: job.id, attempt: job.attempt + 1 },
          "Dispatch failed — requeued for retry",
        );
      } else {
        await storage.markFailed(job.id, reason.slice(0, 2000));
      }
    }
  }

  if (attempted > 0 && allFailedTransient) {
    noteVhOutage("dispatch");
  }
}

async function pollOnce(gracePolls = 3): Promise<void> {
  if (Date.now() < pollNotBefore) return;

  const jobs = await storage.listScanningJobs();
  if (jobs.length === 0) return;

  const vh = getVulnHunterClient();
  let successes = 0;
  let transientFails = 0;

  for (const job of jobs) {
    if (!job.vulnhunter_task_id) continue;
    try {
      const { state, failureReason, metadata } = await vh.getTask(job.vulnhunter_task_id);
      successes += 1;

      if (state === "completed") {
        await syncCompletedFindings(job.id, job.project_id, job.vulnhunter_task_id);
        logger.info({ jobId: job.id }, "Scan job completed, findings synced");
      } else if (state === "cancelled") {
        // fish: cancel = pause; keep scanning, VH continue resumes same task id
        await storage.resetConsecutiveFailures(job.id);
        logger.info({ jobId: job.id }, "VH task cancelled — keeping OV job scanning");
      } else if (state === "failed") {
        if (isNoScanValueFailure(failureReason, metadata)) {
          const note = `vh_no_scan_value:${(failureReason ?? "partial_source").slice(0, 500)}`;
          await markCompletedEmpty(job.id, job.project_id, note);
          logger.info(
            { jobId: job.id, failureReason: failureReason?.slice(0, 120) },
            "VH no-scan-value failure → completed empty",
          );
        } else {
          const n = await storage.bumpConsecutiveFailures(job.id);
          if (n >= gracePolls) {
            const detail = failureReason
              ? `vh_state:failed (x${n}): ${failureReason.slice(0, 400)}`
              : `vh_state:failed (x${n})`;
            await storage.markFailed(job.id, detail);
            logger.warn({ jobId: job.id, strikes: n }, "Scan job failed upstream (grace exhausted)");
          } else {
            logger.warn(
              { jobId: job.id, strikes: n, grace: gracePolls },
              "VH failed — grace poll, keeping scanning",
            );
          }
        }
      } else if (
        state === "running" ||
        state === "preparing" ||
        state === "queued" ||
        state === "paused"
      ) {
        await storage.resetConsecutiveFailures(job.id);
        // Live so_far: list-only count (no detail / no encrypt / no row writes)
        try {
          const n = await countIngestibleFromList(job.vulnhunter_task_id);
          await storage.updateFindingsSoFar(job.id, n);
        } catch (err) {
          logger.warn({ err, jobId: job.id }, "so_far list count failed (will retry)");
        }
      } else if (!KNOWN_VH_ACTIVE.has(state)) {
        // Unknown VH state — grace then fail (do not hang forever)
        const n = await storage.bumpConsecutiveFailures(job.id);
        if (n >= gracePolls) {
          await storage.markFailed(job.id, `vh_state:unknown:${String(state).slice(0, 64)} (x${n})`);
          logger.warn({ jobId: job.id, state, strikes: n }, "Unknown VH state — marked failed");
        } else {
          logger.warn(
            { jobId: job.id, state, strikes: n, grace: gracePolls },
            "Unknown VH state — grace poll",
          );
        }
      }
    } catch (err) {
      if (isVhTaskGoneError(err)) {
        successes += 1;
        try {
          const result = await storage.hardDeleteGoneJob(job.id, job.project_id);
          logger.warn(
            { jobId: job.id, projectId: job.project_id, projectDeleted: result.projectDeleted },
            "VH task gone — hard-deleted OV job/project",
          );
        } catch (delErr) {
          logger.error({ err: delErr, jobId: job.id }, "hardDeleteGoneJob failed");
        }
        continue;
      }
      if (isTransientVhError(err)) {
        transientFails += 1;
        logger.error({ err, jobId: job.id }, "Poll transient error (will retry)");
      } else {
        successes += 1; // non-transient on one job shouldn't trigger full outage
        logger.error({ err, jobId: job.id }, "Poll error (will retry next cycle)");
      }
    }
  }

  if (successes > 0) {
    noteVhSuccess();
  } else if (transientFails > 0 && successes === 0) {
    noteVhOutage("poll");
  }
}

/** scanning path: list + filter count only. */
async function countIngestibleFromList(vhTaskId: string): Promise<number> {
  const vh = getVulnHunterClient();
  const metas = await vh.listFindings(vhTaskId);
  let publicCount = 0;
  for (const meta of metas) {
    if (!shouldIngestFinding(meta, null)) continue;
    const mapped = mapFindingSeverity(meta, null);
    if (mapped.severity !== "info") publicCount += 1;
  }
  return publicCount;
}

interface PreparedFindingRow {
  id: string;
  findingKey: string;
  severity: SeverityStored;
  cwe: string | null;
  title: string;
  primaryFile: string | null;
  detailJson: unknown;
  reportYaml: string | null;
  cvssScore: number | null;
  cvssVector: string | null;
  pocStatus: string;
  itemType: string;
  vhSeverity: string | null;
}

/**
 * completed path:
 *  A) slow IO outside txn — list + detail into memory (plaintext)
 *  B) single txn — disclosure snapshot, delete, insert, flip pointer, markCompleted
 */
async function syncCompletedFindings(
  scanJobId: string,
  projectId: string,
  vhTaskId: string,
): Promise<number> {
  const vh = getVulnHunterClient();
  loadConfig();

  const metas = await vh.listFindings(vhTaskId);
  const prepared: PreparedFindingRow[] = [];
  let publicCount = 0;

  for (const meta of metas) {
    let detail: unknown = null;
    try {
      detail = await vh.getFindingDetail(vhTaskId, meta.key);
    } catch (err) {
      logger.warn({ err, key: meta.key }, "Failed to fetch finding detail; storing meta only");
    }

    if (!shouldIngestFinding(meta, detail)) continue;

    const detailObj = (detail && typeof detail === "object" ? detail : {}) as Record<
      string,
      unknown
    >;
    const title =
      (typeof meta.title === "string" && meta.title) ||
      (typeof detailObj.title === "string" && detailObj.title) ||
      meta.key;
    const cwe =
      (typeof meta.cwe === "string" && meta.cwe) ||
      (typeof detailObj.cwe === "string" && detailObj.cwe) ||
      null;
    const primaryFile =
      (typeof meta.primary_file === "string" && meta.primary_file) ||
      (typeof detailObj.primary_file === "string" && detailObj.primary_file) ||
      null;
    let pocStatus =
      pickString(meta.poc_status, detailObj.poc_status, detailObj.pocStatus) ?? "unknown";
    if (pocStatus.toLowerCase() === "reproduced") pocStatus = "confirmed";
    const itemType =
      pickString(meta.item_type, detailObj.item_type, detailObj.itemType) ?? "finding";

    const mapped = mapFindingSeverity(meta, detail);
    if (mapped.severity !== "info") publicCount += 1;

    // Byte-faithful report.yaml via VH artifacts preview (path findings/<key>/report.yaml)
    let reportYaml: string | null = null;
    try {
      const prev = await vh.getArtifactFilePreview(
        vhTaskId,
        `findings/${meta.key}/report.yaml`,
      );
      if (prev?.kind === "text" && typeof prev.content === "string" && prev.content.length > 0) {
        reportYaml = prev.content;
      }
    } catch (err) {
      logger.warn({ err, key: meta.key }, "report.yaml preview failed");
    }

    const findingId = randomUUID();
    prepared.push({
      id: findingId,
      findingKey: meta.key,
      severity: mapped.severity,
      cwe,
      title,
      primaryFile,
      detailJson: {
        title,
        primary_file: primaryFile,
        detail: detail ?? meta,
        report_yaml: reportYaml,
      },
      reportYaml,
      cvssScore: mapped.cvssScore,
      cvssVector: mapped.cvssVector,
      pocStatus,
      itemType,
      vhSeverity: mapped.vhSeverity,
    });
  }

  const db = getDb();
  await db.begin(async (tx) => {
    // Preserve disclosure state for THIS job's prior findings (same-job retry/resync).
    // Do NOT inherit from other versions (fish rule ⑥: per-version disclosure).
    const priorDisclosure = await findingsStorage.listDisclosureByKeyForJob(scanJobId, tx);

    // Delete only this job's prior findings (retry/resync idempotent).
    const removed = await findingsStorage.deleteAllForJob(scanJobId, tx);
    if (removed > 0) {
      logger.info({ projectId, scanJobId, removed }, "Cleared this job's prior findings before resync");
    }

    for (const row of prepared) {
      const prev = priorDisclosure.get(row.findingKey);
      await findingsStorage.upsertEncryptedFinding(
        {
          id: row.id,
          projectId,
          scanJobId,
          findingKey: row.findingKey,
          severity: row.severity,
          cwe: row.cwe,
          title: row.title,
          primaryFile: row.primaryFile,
          detailJson: row.detailJson,
          encPayload: "",
          disclosureState: prev?.state,
          disclosedAt: prev?.disclosedAt ?? null,
          disclosedTitle: prev?.disclosedTitle ?? null,
          disclosedSummary: prev?.disclosedSummary ?? null,
          disclosedReportYaml: prev?.disclosedReportYaml ?? null,
          cvssScore: row.cvssScore,
          cvssVector: row.cvssVector,
          pocStatus: row.pocStatus,
          itemType: row.itemType,
          vhSeverity: row.vhSeverity,
        },
        tx,
      );
    }

    await storage.updateFindingsSoFar(scanJobId, publicCount, tx);
    await storage.setCurrentScanJob(projectId, scanJobId, tx);
    await storage.markCompleted(scanJobId, tx);

    // Notify submitter (same txn); skip if submitted_by NULL
    // Count from prepared rows — severityCounts() would miss uncommitted inserts.
    const { emptySeverityCounts } = await import("@openvuln/shared");
    const counts = emptySeverityCounts();
    for (const row of prepared) {
      if (row.severity === "critical" || row.severity === "high" || row.severity === "medium" || row.severity === "low") {
        counts[row.severity] += 1;
      }
    }
    const { notificationStorage } = await import("../notifications/index.js");
    await notificationStorage.insertScanCompleted(tx, {
      jobId: scanJobId,
      projectId,
      counts,
      noValue: publicCount === 0,
    });
  });

  // Phase C: harvest poc/exp text (best-effort, after findings committed).
  // CASCADE already cleared old artifacts with findings delete.
  try {
    await harvestFindingArtifacts({
      projectId,
      scanJobId,
      vhTaskId,
      findings: prepared.map((r) => ({ findingId: r.id, findingKey: r.findingKey })),
    });
  } catch (err) {
    logger.warn({ err, scanJobId }, "Artifact harvest failed (findings still saved)");
  }

  return publicCount;
}

/**
 * Admin force-resync: failed job whose VH task is completed → full sync.
 * Returns result descriptor for HTTP layer.
 */
export async function adminResyncScanJob(
  jobId: string,
): Promise<{ ok: true; publicCount: number } | { ok: false; reason: string; vhState?: string }> {
  const job = await storage.getScanJob(jobId);
  if (!job) return { ok: false, reason: "not_found" };
  // Allow failed + completed (re-pull plaintext / recover empty sync)
  if (job.state !== "failed" && job.state !== "completed") {
    return { ok: false, reason: "not_resyncable", vhState: job.state };
  }
  if (!job.vulnhunter_task_id) return { ok: false, reason: "no_vh_task" };

  const vh = getVulnHunterClient();
  let state: string;
  try {
    ({ state } = await vh.getTask(job.vulnhunter_task_id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `vh_unreachable: ${msg.slice(0, 200)}` };
  }

  if (state !== "completed") {
    return { ok: false, reason: "vh_not_completed", vhState: state };
  }

  // failed jobs: revive scanning flag; completed: syncCompletedFindings re-marks completed
  if (job.state === "failed") {
    await storage.reviveFailedForResync(job.id);
  }
  const publicCount = await syncCompletedFindings(job.id, job.project_id, job.vulnhunter_task_id);
  logger.info({ jobId: job.id, publicCount }, "Admin resync completed");
  return { ok: true, publicCount };
}

/** Delete VH task only (no OV row change). 404 acceptable. */
export async function deleteVhTaskOnly(vhTaskId: string): Promise<void> {
  const vh = getVulnHunterClient();
  try {
    await vh.deleteTask(vhTaskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("not_found") && !msg.includes("404")) {
      throw err;
    }
  }
}

/**
 * @deprecated Prefer owner cancelScanJob (hard delete). Kept for callers that
 * still want VH delete + markCancelled.
 */
export async function cancelScanJobVh(
  jobId: string,
  vhTaskId: string,
): Promise<void> {
  await deleteVhTaskOnly(vhTaskId);
  await storage.markCancelled(jobId, "cancelled_by_user");
  logger.info({ jobId, vhTaskId }, "Scan job cancelled (VH task deleted)");
}

export function startScanLoops(config: ServiceConfig): void {
  if (running) return;
  running = true;

  const runDispatch = () => {
    if (dispatchBusy) return;
    dispatchBusy = true;
    const conc = getEffectiveConcurrency(config.scan.concurrency);
    dispatchOnce(conc)
      .catch((err) => logger.error({ err }, "dispatcher tick failed"))
      .finally(() => {
        dispatchBusy = false;
      });
  };
  const runPoll = () => {
    if (pollBusy) return;
    pollBusy = true;
    pollOnce(config.scan.vhFailGracePolls)
      .catch((err) => logger.error({ err }, "poller tick failed"))
      .finally(() => {
        pollBusy = false;
      });
  };

  runDispatch();
  runPoll();
  dispatcherTimer = setInterval(runDispatch, config.scan.dispatcherIntervalMs);
  pollerTimer = setInterval(runPoll, config.scan.pollerIntervalMs);
  logger.info(
    {
      concurrency: getEffectiveConcurrency(config.scan.concurrency),
      dispatcherMs: config.scan.dispatcherIntervalMs,
      pollerMs: config.scan.pollerIntervalMs,
      vhFailGracePolls: config.scan.vhFailGracePolls,
    },
    "Scan dispatcher + poller started",
  );
}

export function stopScanLoops(): void {
  if (dispatcherTimer) clearInterval(dispatcherTimer);
  if (pollerTimer) clearInterval(pollerTimer);
  dispatcherTimer = null;
  pollerTimer = null;
  running = false;
  dispatchBusy = false;
  pollBusy = false;
}

export const _internal = {
  dispatchOnce,
  pollOnce,
  syncCompletedFindings,
  countIngestibleFromList,
  mapFindingSeverity,
  shouldIngestFinding,
  isNoScanValueFailure,
  markCompletedEmpty,
  setRuntimeConcurrency,
  getScanConfigView,
  noteVhOutage,
  noteVhSuccess,
  get backoffState() {
    return { vhOutageStrikes, pollNotBefore, dispatchNotBefore };
  },
  resetBackoffForTests() {
    vhOutageStrikes = 0;
    pollNotBefore = 0;
    dispatchNotBefore = 0;
    runtimeConcurrency = null;
  },
};
