import type { Severity } from "@openvuln/shared";
import { logger } from "../../infra/logger.js";
import type { ServiceConfig } from "../../infra/config.js";
import { getVulnHunterClient } from "../vulnhunter/index.js";
import { getDb } from "../../infra/db/index.js";
import * as storage from "./storage.js";
import * as findingsStorage from "../findings/storage.js";

let dispatcherTimer: ReturnType<typeof setInterval> | null = null;
let pollerTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

function normalizeSeverity(raw: string | undefined): Severity {
  const s = (raw ?? "info").toLowerCase();
  if (s === "high" || s === "medium" || s === "low" || s === "info") return s;
  if (s === "critical") return "high"; // VH has no critical; map up if ever seen
  return "info";
}

async function getProjectMeta(projectId: string): Promise<{ full_name: string; html_url: string } | null> {
  const db = getDb();
  const rows = await db<{ full_name: string; html_url: string }[]>`
    SELECT full_name, html_url FROM projects WHERE id = ${projectId}::uuid
  `;
  return rows[0] ?? null;
}

async function dispatchOnce(concurrency: number): Promise<void> {
  const inFlight = await storage.countInFlight();
  const slots = concurrency - inFlight;
  if (slots <= 0) return;

  const jobs = await storage.claimQueuedJobs(slots);
  if (jobs.length === 0) return;

  const vh = getVulnHunterClient();

  for (const job of jobs) {
    const project = await getProjectMeta(job.project_id);
    if (!project) {
      await storage.markFailed(job.id, "project_missing");
      continue;
    }
    const shortId = job.id.slice(0, 8);
    const displayName = `${project.full_name} #${shortId}`;
    try {
      logger.info({ jobId: job.id, project: project.full_name }, "Dispatching scan job to VH");
      const { taskId } = await vh.createScanTask({
        gitUrl: project.html_url,
        displayName,
      });
      await storage.markScanning(job.id, taskId);
      logger.info({ jobId: job.id, vhTaskId: taskId }, "Scan job dispatched");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobId: job.id }, "Failed to dispatch scan job");
      await storage.markFailed(job.id, reason.slice(0, 2000));
    }
  }
}

async function pollOnce(): Promise<void> {
  const jobs = await storage.listScanningJobs();
  if (jobs.length === 0) return;

  const vh = getVulnHunterClient();

  for (const job of jobs) {
    if (!job.vulnhunter_task_id) continue;
    try {
      const { state } = await vh.getTask(job.vulnhunter_task_id);
      if (state === "completed") {
        await syncFindings(job.id, job.project_id, job.vulnhunter_task_id);
        await storage.markCompleted(job.id);
        logger.info({ jobId: job.id }, "Scan job completed, findings synced");
      } else if (state === "failed" || state === "cancelled") {
        await storage.markFailed(job.id, `vh_state:${state}`);
        logger.warn({ jobId: job.id, vhState: state }, "Scan job failed upstream");
      }
      // queued/preparing/running/paused → keep scanning
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Poll error (will retry next cycle)");
    }
  }
}

async function syncFindings(scanJobId: string, projectId: string, vhTaskId: string): Promise<void> {
  const vh = getVulnHunterClient();
  const metas = await vh.listFindings(vhTaskId);

  // BUG-1: latest completed scan replaces project findings (no cumulative double-count).
  // Preserve prior disclosure decisions when finding_key matches across rescans.
  const priorDisclosure = await findingsStorage.listDisclosureByKey(projectId);
  const removed = await findingsStorage.deleteAllForProject(projectId);
  if (removed > 0) {
    logger.info({ projectId, scanJobId, removed }, "Cleared prior findings before resync");
  }

  for (const meta of metas) {
    let detail: unknown = null;
    try {
      detail = await vh.getFindingDetail(vhTaskId, meta.key);
    } catch (err) {
      logger.warn({ err, key: meta.key }, "Failed to fetch finding detail; storing meta only");
    }

    const detailObj = (detail && typeof detail === "object" ? detail : {}) as Record<string, unknown>;
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

    const prev = priorDisclosure.get(meta.key);
    await findingsStorage.upsertFinding({
      projectId,
      scanJobId,
      findingKey: meta.key,
      severity: normalizeSeverity(meta.severity),
      title,
      cwe,
      primaryFile,
      detailJson: detail ?? meta,
      disclosureState: prev?.state,
      disclosedAt: prev?.disclosedAt ?? null,
      disclosedBy: prev?.disclosedBy ?? null,
    });
  }
}

export function startScanLoops(config: ServiceConfig): void {
  if (running) return;
  running = true;

  const runDispatch = () => {
    dispatchOnce(config.scan.concurrency).catch((err) =>
      logger.error({ err }, "dispatcher tick failed"),
    );
  };
  const runPoll = () => {
    pollOnce().catch((err) => logger.error({ err }, "poller tick failed"));
  };

  // Kick immediately, then interval
  runDispatch();
  runPoll();
  dispatcherTimer = setInterval(runDispatch, config.scan.dispatcherIntervalMs);
  pollerTimer = setInterval(runPoll, config.scan.pollerIntervalMs);
  logger.info(
    {
      concurrency: config.scan.concurrency,
      dispatcherMs: config.scan.dispatcherIntervalMs,
      pollerMs: config.scan.pollerIntervalMs,
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
}

/** Test helpers */
export const _internal = { dispatchOnce, pollOnce, syncFindings, normalizeSeverity };
