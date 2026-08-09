import { Hono } from "hono";
import JSZip from "jszip";
import { requireAuth } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireRepoAccess } from "../auth/permission.js";
import { findingsStorage } from "../findings/index.js";
import { listArtifactsForFinding } from "../findings/artifacts-storage.js";
import { parseReportYaml, renderReportYamlToMarkdown } from "../report/yaml-render.js";
import { scanStorage } from "../scans/index.js";
import * as service from "./service.js";
import * as storage from "./storage.js";

export const projectsRouter = new Hono();

// GET /api/projects/mine — submitter's projects (requireAuth)
projectsRouter.get("/mine", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  const rows = await storage.listBySubmitter(user.githubUserId);
  const cards = [];
  for (const p of rows) {
    cards.push(await service.projectToCard(p));
  }
  return c.json({ projects: cards });
});

// Owner: cancel scan job
projectsRouter.post("/:projectId/scan-jobs/:jobId/cancel", requireAuth, async (c) => {
  const projectId = c.req.param("projectId");
  const jobId = c.req.param("jobId");
  if (!findingsStorage.isUuid(projectId) || !findingsStorage.isUuid(jobId)) {
    throw new AppError("ERR_VALIDATION", { fields: ["projectId", "jobId"] });
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
  const result = await service.cancelScanJob(projectId, jobId);
  return c.json(result);
});

// Owner: list scan history (all states)
projectsRouter.get("/:projectId/scans", requireAuth, async (c) => {
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
  const scans = await scanStorage.listAllScans(projectId);
  return c.json({
    scans: scans.map((s) => ({
      id: s.id,
      state: s.state,
      commit_sha: s.commit_sha,
      git_ref: (s as unknown as Record<string, unknown>).git_ref ?? null,
      findings_so_far: s.findings_so_far,
      created_at: s.created_at.toISOString(),
      finished_at: s.finished_at?.toISOString() ?? null,
    })),
  });
});

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
  const refRaw =
    typeof body?.ref === "string"
      ? body.ref
      : typeof body?.git_ref === "string"
        ? body.git_ref
        : undefined;
  const ref = typeof refRaw === "string" ? refRaw.trim() : undefined;
  const result = await service.submitProject(gitUrl.trim(), config, user, ref);
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
  const scanJobId = c.req.query("scan_job_id") ?? undefined;
  const findings = await findingsStorage.listAllForOwner(projectId, scanJobId);
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
  const scanJobId = c.req.query("scan_job_id") ?? undefined;
  const findings = await findingsStorage.listAllForOwner(projectId, scanJobId);
  const finding = findings.find((f) => f.finding_key === key || f.id === key);
  if (!finding) throw new AppError("ERR_NOT_FOUND", { resource: "finding" });
  const artifacts = await listArtifactsForFinding(finding.id);
  const reportYaml = findingsStorage.extractReportYaml(
    finding.detail_json,
    finding.report_yaml,
  );
  let report = null;
  if (reportYaml) {
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
  const scanJobId = c.req.query("scan_job_id") ?? undefined;
  const findings = await findingsStorage.listAllForOwner(projectId, scanJobId);
  if (format === "json") {
    return c.json({
      project: { id: project.id, full_name: project.full_name },
      findings,
    });
  }

  const slug = project.full_name.replace(/[^A-Za-z0-9._-]+/g, "-");
  const parts: string[] = [`# OpenVuln report — ${project.full_name}\n`];
  const yamlByKey = new Map<string, string>();
  for (const f of findings) {
    parts.push(`\n## [${f.severity}] ${f.title}\n`);
    parts.push(`- key: \`${f.finding_key}\`\n`);
    parts.push(`- disclosure: ${f.disclosure_state}\n`);
    if (f.cwe) parts.push(`- cwe: ${f.cwe}\n`);
    if (f.primary_file) parts.push(`- file: \`${f.primary_file}\`\n`);
    const yaml = findingsStorage.extractReportYaml(f.detail_json, f.report_yaml);
    if (yaml) {
      yamlByKey.set(f.finding_key, yaml);
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
  const mdBody = parts.join("");

  if (format === "zip") {
    const zip = new JSZip();
    zip.file("index.md", mdBody);
    zip.file(
      "index.json",
      JSON.stringify(
        {
          project: { id: project.id, full_name: project.full_name },
          findings: findings.map((f) => ({
            finding_key: f.finding_key,
            severity: f.severity,
            title: f.title,
            cwe: f.cwe,
            primary_file: f.primary_file,
            disclosure_state: f.disclosure_state,
            cvss_score: f.cvss_score,
            poc_status: f.poc_status,
          })),
        },
        null,
        2,
      ),
    );
    const findingsDir = zip.folder("findings");
    if (findingsDir) {
      // Full plaintext pack (content_text) — listArtifactsForFinding omits body
      const { listArtifactsForProject } = await import("../findings/artifacts-storage.js");
      const allArts = await listArtifactsForProject(projectId);
      const artsByFinding = new Map<string, typeof allArts>();
      for (const a of allArts) {
        const list = artsByFinding.get(a.finding_id) ?? [];
        list.push(a);
        artsByFinding.set(a.finding_id, list);
      }
      for (const f of findings) {
        const dir = findingsDir.folder(f.finding_key.replace(/[^A-Za-z0-9._-]+/g, "-") || "item");
        if (!dir) continue;
        const yaml = yamlByKey.get(f.finding_key);
        if (yaml) dir.file("report.yaml", yaml);
        for (const a of artsByFinding.get(f.id) ?? []) {
          if (a.content_text) {
            dir.file(a.rel_path || a.file_name, a.content_text);
          }
        }
      }
    }
    const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return new Response(Buffer.from(buf), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="openvuln-${slug}-full.zip"`,
        "cache-control": "no-store",
      },
    });
  }

  // default markdown pack
  return new Response(mdBody, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="openvuln-${slug}-full.md"`,
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
