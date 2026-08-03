import { Hono } from "hono";
import { requireAuth } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireRepoAccess } from "../auth/permission.js";
import { findingsStorage } from "../findings/index.js";
import { listArtifactsForFinding } from "../findings/artifacts-storage.js";
import { parseReportYaml, renderReportYamlToMarkdown } from "../report/yaml-render.js";
import * as service from "./service.js";
import * as storage from "./storage.js";

export const projectsRouter = new Hono();

// GET /api/projects?sort=newest|stars&page=
projectsRouter.get("/", async (c) => {
  const sort = c.req.query("sort") ?? "newest";
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("page_size") ?? "20");
  const result = await service.listProjects({ sort, page, pageSize });
  return c.json(result);
});

// POST /api/projects { git_url } — requires GitHub auth + repo admin/maintain
projectsRouter.post("/", requireAuth, async (c) => {
  const config = c.get("config");
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  const body = await c.req.json().catch(() => null);
  const gitUrl = body?.git_url;
  if (typeof gitUrl !== "string" || !gitUrl.trim()) {
    throw new AppError("ERR_VALIDATION", { field: "git_url" });
  }
  const result = await service.submitProject(gitUrl.trim(), config, user);
  return c.json(result, 201);
});

// Owner: list all findings (incl. owner_only)
projectsRouter.get("/:projectId/findings", requireAuth, async (c) => {
  const projectId = c.req.param("projectId");
  if (!findingsStorage.isUuid(projectId)) {
    throw new AppError("ERR_VALIDATION", { field: "projectId" });
  }
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  const project = await storage.findById(projectId);
  if (!project) throw new AppError("ERR_NOT_FOUND", { resource: "project" });
  await requireRepoAccess(
    user,
    project.owner_login,
    project.name,
    Number(project.github_repo_id),
    c.get("config"),
  );
  const findings = await findingsStorage.listAllForOwner(projectId);
  return c.json({ project_id: projectId, findings });
});

// Owner: single finding full detail
projectsRouter.get("/:projectId/findings/:key", requireAuth, async (c) => {
  const projectId = c.req.param("projectId");
  const key = c.req.param("key");
  if (!findingsStorage.isUuid(projectId)) {
    throw new AppError("ERR_VALIDATION", { field: "projectId" });
  }
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  const project = await storage.findById(projectId);
  if (!project) throw new AppError("ERR_NOT_FOUND", { resource: "project" });
  await requireRepoAccess(
    user,
    project.owner_login,
    project.name,
    Number(project.github_repo_id),
    c.get("config"),
  );
  const findings = await findingsStorage.listAllForOwner(projectId);
  const finding = findings.find((f) => f.finding_key === key || f.id === key);
  if (!finding) throw new AppError("ERR_NOT_FOUND", { resource: "finding" });
  const artifacts = await listArtifactsForFinding(finding.id);
  let report = null;
  if (finding.report_yaml) {
    const p = parseReportYaml(finding.report_yaml);
    if (p) {
      report = {
        metadata: p.metadata,
        description: p.description,
        code: p.code,
        references: p.references,
      };
    }
  }
  // Prefer report_yaml from detail_json if disclosed_report_yaml empty
  let reportYaml = finding.report_yaml;
  if (!reportYaml && finding.detail_json && typeof finding.detail_json === "object") {
    const d = finding.detail_json as Record<string, unknown>;
    if (typeof d.report_yaml === "string") reportYaml = d.report_yaml;
  }
  if (!report && reportYaml) {
    const p = parseReportYaml(reportYaml);
    if (p) {
      report = {
        metadata: p.metadata,
        description: p.description,
        code: p.code,
        references: p.references,
      };
    }
  }
  return c.json({
    project_id: projectId,
    finding: {
      ...finding,
      report_yaml: reportYaml,
      report,
      artifacts,
    },
  });
});

// Owner self-disclose
projectsRouter.post("/:projectId/disclose", requireAuth, async (c) => {
  const projectId = c.req.param("projectId");
  if (!findingsStorage.isUuid(projectId)) {
    throw new AppError("ERR_VALIDATION", { field: "projectId" });
  }
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  const project = await storage.findById(projectId);
  if (!project) throw new AppError("ERR_NOT_FOUND", { resource: "project" });
  await requireRepoAccess(
    user,
    project.owner_login,
    project.name,
    Number(project.github_repo_id),
    c.get("config"),
  );
  const body = await c.req.json().catch(() => null);
  const ids = body?.finding_ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x: unknown) => typeof x === "string")) {
    throw new AppError("ERR_VALIDATION", { field: "finding_ids" });
  }
  const count = await findingsStorage.ownerDiscloseFindings(projectId, ids as string[]);
  return c.json({ disclosed_count: count });
});

// Owner full report download (all findings on current scan)
projectsRouter.get("/:projectId/report-full", requireAuth, async (c) => {
  const projectId = c.req.param("projectId");
  if (!findingsStorage.isUuid(projectId)) {
    throw new AppError("ERR_VALIDATION", { field: "projectId" });
  }
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  const project = await storage.findById(projectId);
  if (!project) throw new AppError("ERR_NOT_FOUND", { resource: "project" });
  await requireRepoAccess(
    user,
    project.owner_login,
    project.name,
    Number(project.github_repo_id),
    c.get("config"),
  );
  const format = (c.req.query("format") ?? "md").toLowerCase();
  const findings = await findingsStorage.listAllForOwner(projectId);
  if (format === "json") {
    return c.json({
      project: { id: project.id, full_name: project.full_name },
      findings,
    });
  }
  // default markdown pack
  const parts: string[] = [`# OpenVuln report — ${project.full_name}\n`];
  for (const f of findings) {
    parts.push(`\n## [${f.severity}] ${f.title}\n`);
    parts.push(`- key: \`${f.finding_key}\`\n`);
    parts.push(`- disclosure: ${f.disclosure_state}\n`);
    if (f.cwe) parts.push(`- cwe: ${f.cwe}\n`);
    if (f.primary_file) parts.push(`- file: \`${f.primary_file}\`\n`);
    let yaml =
      f.report_yaml ??
      (f.detail_json && typeof f.detail_json === "object"
        ? ((f.detail_json as Record<string, unknown>).report_yaml as string | undefined)
        : undefined);
    if (yaml && typeof yaml === "string") {
      try {
        parts.push(
          "\n" +
            renderReportYamlToMarkdown(yaml, {
              findingKey: f.finding_key,
              projectFullName: project.full_name,
            }) +
            "\n",
        );
      } catch {
        parts.push("\n```yaml\n" + yaml.slice(0, 50_000) + "\n```\n");
      }
    }
  }
  const body = parts.join("");
  const filename = `openvuln-${project.full_name.replace(/[^A-Za-z0-9._-]+/g, "-")}-full.md`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});

// GET /api/projects/:owner/:repo  — public view
projectsRouter.get("/:owner/:repo", async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  // UUID path segments are owner endpoints above; avoid treating as owner/repo
  if (findingsStorage.isUuid(owner)) {
    throw new AppError("ERR_NOT_FOUND", { resource: "project" });
  }
  const result = await service.getPublicView(owner, repo);
  return c.json(result);
});
