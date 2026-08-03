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
import { fetchDefaultBranchHeadSha, parseGitHubUrl, resolveRootRepo } from "./github-sync.js";
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
): Promise<SubmitProjectResponse> {
  const parsed = parseGitHubUrl(gitUrl);
  if (!parsed) {
    throw new AppError("ERR_VALIDATION", {
      field: "git_url",
      reason: "invalid_github_url",
      message: "Provide a valid GitHub URL or owner/repo",
    });
  }

  const { meta, wasFork } = await resolveRootRepo(
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

  // If user submitted a fork, we register the upstream root (already resolved)
  void wasFork;

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

  const existing = await storage.findByRepoId(meta.id);
  if (existing) {
    const last = await scanStorage.lastScanCreatedAt(existing.id);
    if (last) {
      const cooldownMs = config.scan.cooldownDays * 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - last.getTime();
      if (elapsed < cooldownMs) {
        const retryAfterDays = Math.ceil((cooldownMs - elapsed) / (24 * 60 * 60 * 1000));
        throw new AppError("ERR_CONFLICT", {
          reason: "cooldown",
          project_id: existing.id,
          retry_after_days: retryAfterDays,
          message: `Project already scanned. Retry after ${retryAfterDays} day(s).`,
        });
      }
    }
    // Cooldown passed — enqueue a new scan on existing project
    const sha = await fetchDefaultBranchHeadSha(
      meta.owner.login,
      meta.name,
      meta.default_branch,
      config.github.serverToken,
    );
    await scanStorage.createScanJob(existing.id, sha);
    const counts = await findingsStorage.severityCounts(existing.id);
    return { project: await toCard(existing, counts) };
  }

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
    // BUG-2: concurrent submit races past findByRepoId → unique_violation.
    // Map to the same 409 cooldown/conflict path as sequential duplicates.
    if (!storage.isUniqueViolation(err)) throw err;
    const raced = await storage.findByRepoId(meta.id);
    if (!raced) throw err;
    const last = await scanStorage.lastScanCreatedAt(raced.id);
    if (last) {
      const cooldownMs = config.scan.cooldownDays * 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - last.getTime();
      if (elapsed < cooldownMs) {
        const retryAfterDays = Math.ceil((cooldownMs - elapsed) / (24 * 60 * 60 * 1000));
        throw new AppError("ERR_CONFLICT", {
          reason: "cooldown",
          project_id: raced.id,
          retry_after_days: retryAfterDays,
          message: `Project already scanned. Retry after ${retryAfterDays} day(s).`,
        });
      }
    }
    // Cooldown already passed on the winner — treat as conflict on the in-flight create.
    throw new AppError("ERR_CONFLICT", {
      reason: "duplicate",
      project_id: raced.id,
      message: "Project was just submitted by another request.",
    });
  }

  const sha = await fetchDefaultBranchHeadSha(
    meta.owner.login,
    meta.name,
    meta.default_branch,
    config.github.serverToken,
  );
  await scanStorage.createScanJob(project.id, sha);

  return { project: await toCard(project, emptyCounts()) };
}
