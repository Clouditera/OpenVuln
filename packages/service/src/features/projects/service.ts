import type {
  ProjectCard,
  ProjectListResponse,
  ProjectPublicView,
  SeverityCounts,
  SubmitProjectResponse,
} from "@openvuln/shared";
import { emptySeverityCounts } from "@openvuln/shared";
import type { ServiceConfig } from "../../infra/config.js";
import type { AuthUser } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireRepoAccess } from "../auth/permission.js";
import { authStorage } from "../auth/index.js";
import { findingsStorage } from "../findings/index.js";
import { parseReportYaml } from "../report/yaml-render.js";
import { type ScanJobRow, scanStorage } from "../scans/index.js";
import { getScanConfig } from "../scans/config-storage.js";
import { writeAudit } from "../admin/audit.js";
import { fetchDefaultBranchHeadSha, fetchRepoMeta, parseGitHubUrl } from "./github-sync.js";
import * as storage from "./storage.js";
import type { ProjectRow } from "./storage.js";

function emptyCounts(): SeverityCounts {
  return emptySeverityCounts();
}

function toScanSummary(scan: ScanJobRow | null) {
  if (!scan) return null;
  return {
    id: scan.id,
    state: scan.state,
    commit_sha: scan.commit_sha,
    created_at: scan.created_at.toISOString(),
    finished_at: scan.finished_at?.toISOString() ?? null,
    findings_so_far: scan.findings_so_far ?? 0,
  };
}

export async function projectToCard(project: ProjectRow): Promise<ProjectCard> {
  const counts = await findingsStorage.severityCounts(project.id);
  return toCard(project, counts);
}

async function toCard(project: ProjectRow, counts: SeverityCounts): Promise<ProjectCard> {
  const latest = await scanStorage.getLatestScanForProject(project.id);
  return {
    id: project.id,
    owner_login: project.owner_login,
    name: project.name,
    full_name: project.full_name,
    html_url: project.html_url,
    description: project.description,
    language: project.language,
    stars: project.stars,
    default_branch: project.default_branch,
    latest_scan: toScanSummary(latest),
    severity_counts: counts,
    created_at: project.created_at.toISOString(),
  };
}

export async function listProjects(opts: {
  sort?: string;
  page?: number;
  pageSize?: number;
}): Promise<ProjectListResponse> {
  const sort = opts.sort === "stars" ? "stars" : "newest";
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 20));

  const { rows, total } = await storage.listProjects({ sort, page, pageSize });
  const countsMap = await findingsStorage.severityCountsMany(rows.map((r) => r.id));

  const items: ProjectCard[] = [];
  for (const p of rows) {
    items.push(await toCard(p, countsMap.get(p.id) ?? emptyCounts()));
  }

  return { items, page, page_size: pageSize, total };
}

export async function getPublicView(owner: string, repo: string): Promise<ProjectPublicView> {
  const project = await storage.findByFullName(owner, repo);
  if (!project) throw new AppError("ERR_NOT_FOUND", { resource: "project" });

  const latest = await scanStorage.getLatestScanForProject(project.id);
  const severity_counts = await findingsStorage.severityCounts(project.id);
  const cwe_distribution = await findingsStorage.cweDistribution(project.id);
  // RED LINE: only disclosed findings — storage method filters disclosure_state
  const disclosed = await findingsStorage.listDisclosedSummaries(project.id);

  return {
    id: project.id,
    owner_login: project.owner_login,
    name: project.name,
    full_name: project.full_name,
    html_url: project.html_url,
    description: project.description,
    language: project.language,
    stars: project.stars,
    default_branch: project.default_branch,
    latest_scan: latest
      ? {
          id: latest.id,
          state: latest.state,
          commit_sha: latest.commit_sha,
          created_at: latest.created_at.toISOString(),
          started_at: latest.started_at?.toISOString() ?? null,
          finished_at: latest.finished_at?.toISOString() ?? null,
          findings_so_far: latest.findings_so_far ?? 0,
        }
      : null,
    severity_counts,
    cwe_distribution,
    disclosed_findings: disclosed.map((f) => {
      let report: {
        metadata: Record<string, unknown>;
        description: Record<string, unknown>;
        code: Record<string, unknown>;
        references: unknown;
      } | null = null;
      if (f.report_yaml) {
        const p = parseReportYaml(f.report_yaml);
        if (p) {
          report = {
            metadata: p.metadata,
            description: p.description,
            code: p.code,
            references: p.references,
          };
        }
      }
      return {
        id: f.id,
        finding_key: f.finding_key,
        severity: f.severity,
        title: f.title,
        cwe: f.cwe,
        disclosed_at: f.disclosed_at?.toISOString() ?? null,
        summary: f.summary ?? null,
        report,
      };
    }),
    created_at: project.created_at.toISOString(),
  };
}

export async function submitProject(
  gitUrl: string,
  config: ServiceConfig,
  user: AuthUser,
  ref?: string,
): Promise<SubmitProjectResponse> {
  const parsed = parseGitHubUrl(gitUrl);
  if (!parsed) {
    throw new AppError("ERR_VALIDATION", {
      field: "git_url",
      reason: "invalid_github_url",
      message: "Provide a valid GitHub URL or owner/repo",
    });
  }

  // Fetch repo meta directly (no fork resolution — forks treated as independent projects)
  const meta = await fetchRepoMeta(
    parsed.owner,
    parsed.repo,
    config.github.serverToken,
  );

  if (meta.private) {
    throw new AppError("ERR_VALIDATION", {
      field: "git_url",
      reason: "private_repo",
      message: "Only public repositories are accepted",
    });
  }

  // Maintainer/admin only + daily rate limit
  await requireRepoAccess(user, meta.owner.login, meta.name, meta.id, config);
  const submitCount = await authStorage.bumpSubmitCount(user.githubUserId);
  if (submitCount > config.submitDailyLimit) {
    throw new AppError("ERR_CONFLICT", {
      reason: "submit_rate_limit",
      limit: config.submitDailyLimit,
      message: `Daily submit limit of ${config.submitDailyLimit} reached.`,
    });
  }

  // Resolve version: ref or default branch HEAD → full SHA
  const resolvedRef = ref?.trim() || meta.default_branch;
  const commitSha = await fetchDefaultBranchHeadSha(
    meta.owner.login,
    meta.name,
    resolvedRef,
    config.github.serverToken,
  );
  if (!commitSha) {
    throw new AppError("ERR_VALIDATION", {
      field: "ref",
      reason: "ref_not_found",
      message: `Branch/tag/commit "${resolvedRef}" not found`,
    });
  }

  const existing = await storage.findByRepoId(meta.id);
  if (existing) {
    // Idempotent: same version already completed → return existing result
    const completed = await scanStorage.findCompletedBySha(existing.id, commitSha);
    if (completed) {
      const counts = await findingsStorage.severityCounts(existing.id);
      return { project: await toCard(existing, counts) };
    }

    // Single in-flight: any version scanning → 409
    const inFlight = await scanStorage.findInFlight(existing.id);
    if (inFlight) {
      throw new AppError("ERR_CONFLICT", {
        reason: "scan_in_progress",
        job_id: inFlight.id,
        state: inFlight.state,
        message: `A scan is already in progress for this project (${inFlight.state}). Cancel it or wait for completion.`,
      });
    }

    // New version scan
    await scanStorage.createScanJob(existing.id, commitSha, resolvedRef);
    await maybeAutoApprove();
    const counts = await findingsStorage.severityCounts(existing.id);
    return { project: await toCard(existing, counts) };
  }

  // New project
  let project: ProjectRow;
  try {
    project = await storage.insertProject({
      githubRepoId: meta.id,
      ownerLogin: meta.owner.login,
      name: meta.name,
      fullName: meta.full_name,
      htmlUrl: meta.html_url,
      description: meta.description,
      language: meta.language,
      stars: meta.stargazers_count ?? 0,
      defaultBranch: meta.default_branch,
      submittedBy: user.githubUserId,
    });
  } catch (err) {
    if (!storage.isUniqueViolation(err)) throw err;
    // Concurrent create — retry idempotent check
    const raced = await storage.findByRepoId(meta.id);
    if (!raced) throw err;
    const completed = await scanStorage.findCompletedBySha(raced.id, commitSha);
    if (completed) {
      const counts = await findingsStorage.severityCounts(raced.id);
      return { project: await toCard(raced, counts) };
    }
    const inFlight = await scanStorage.findInFlight(raced.id);
    if (inFlight) {
      throw new AppError("ERR_CONFLICT", {
        reason: "scan_in_progress",
        job_id: inFlight.id,
        state: inFlight.state,
        message: `A scan is already in progress for this project.`,
      });
    }
    throw new AppError("ERR_CONFLICT", {
      reason: "duplicate",
      project_id: raced.id,
      message: "Project was just submitted by another request.",
    });
  }

  await scanStorage.createScanJob(project.id, commitSha, resolvedRef);
  await maybeAutoApprove();
  return { project: await toCard(project, emptyCounts()) };
}

/**
 * Cancel a scan job (owner action).
 * pending_review / queued / scanning → hard-delete local job/project immediately.
 * VH cleanup is async via vh_teardown_queue (never blocks / 502s the user).
 */
export async function cancelScanJob(
  projectId: string,
  jobId: string,
): Promise<{ ok: true; deleted: "job" | "project" }> {
  const job = await scanStorage.getScanJob(jobId);
  if (!job || job.project_id !== projectId) {
    throw new AppError("ERR_NOT_FOUND", { resource: "scan_job" });
  }
  if (job.state === "dispatching") {
    throw new AppError("ERR_CONFLICT", {
      reason: "try_later",
      message: "Job is being dispatched, please retry in a moment.",
    });
  }
  if (
    job.state !== "pending_review" &&
    job.state !== "queued" &&
    job.state !== "scanning"
  ) {
    throw new AppError("ERR_CONFLICT", {
      reason: "already_terminal",
      state: job.state,
      message: `Job is already ${job.state}.`,
    });
  }

  const vhTaskId = job.vulnhunter_task_id;
  const { projectDeleted } = await scanStorage.hardDeleteGoneJob(jobId, projectId);
  if (vhTaskId) {
    await scanStorage.enqueueVhTeardown(vhTaskId);
  }
  return { ok: true, deleted: projectDeleted ? "project" : "job" };
}

/**
 * Auto-approve: if enabled in scan_config, approve all pending_review jobs
 * on each submit trigger, ordered by strategy (stars_desc | fifo).
 * No limit (fish No.1803). Audit logs each approval.
 */
async function maybeAutoApprove(): Promise<void> {
  let cfg;
  try {
    cfg = await getScanConfig();
  } catch {
    return; // table missing on fresh boot
  }
  if (!cfg.auto_approve_enabled) return;

  const pending = await scanStorage.listPendingReviewWithStars();
  if (pending.length === 0) return;

  const strategy = cfg.auto_approve_strategy ?? "fifo";
  const sorted = [...pending].sort((a, b) => {
    if (strategy === "stars_desc") {
      const starDiff = (b.stars ?? 0) - (a.stars ?? 0);
      if (starDiff !== 0) return starDiff;
      return a.created_at.getTime() - b.created_at.getTime();
    }
    return a.created_at.getTime() - b.created_at.getTime();
  });

  for (const job of sorted) {
    const approved = await scanStorage.approveScanJob(job.id);
    if (approved) {
      await writeAudit("auto_approve", "scan_job", job.id, {
        strategy,
        project: job.full_name,
        stars: job.stars ?? 0,
      }).catch(() => {});
    }
  }
}
