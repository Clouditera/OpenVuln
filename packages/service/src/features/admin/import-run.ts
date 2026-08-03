/**
 * Offline import (path B): encrypt VulnForge/VH-style findings and shelf them
 * as a completed scan_job without calling VulnHunter.
 */
import { randomUUID } from "node:crypto";
import { severityFromCvss, type SeverityStored } from "@openvuln/shared";
import { loadConfig } from "../../infra/config.js";
import { getDb } from "../../infra/db/index.js";
import { logger } from "../../infra/logger.js";
import { findingsStorage } from "../findings/index.js";
import * as artifactStorage from "../findings/artifacts-storage.js";
import * as scanStorage from "../scans/storage.js";
import * as projectStorage from "../projects/storage.js";
import { parseGitHubUrl } from "../projects/github-sync.js";
import { fetchDefaultBranchHeadSha, resolveRootRepo } from "../projects/github.js";

export type ImportArtifact = {
  kind: "poc" | "exp" | "other";
  rel_path: string;
  file_name: string;
  content: string;
};

export type ImportFinding = {
  finding_key: string;
  report_yaml: string;
  title?: string;
  cwe?: string | null;
  primary_file?: string | null;
  cvss_score?: number | null;
  cvss_vector?: string | null;
  severity?: string | null;
  poc_status?: string | null;
  finding_class?: string | null;
  artifacts?: ImportArtifact[];
};

export type ImportBody = {
  /** GitHub full_name or URL — required if project does not exist yet */
  repo?: string;
  project_id?: string;
  commit_sha?: string | null;
  findings: ImportFinding[];
};

const TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".py",
  ".sh",
  ".js",
  ".ts",
  ".c",
  ".h",
  ".yaml",
  ".yml",
  ".json",
  ".log",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".html",
  ".xml",
  ".csv",
]);

export function mapImportPocStatus(raw: string | null | undefined): string {
  const s = (raw ?? "unknown").toLowerCase();
  if (s === "reproduced") return "confirmed";
  if (s === "confirmed" || s === "not-needed" || s === "unknown" || s === "pending") return s;
  if (s === "failed" || s === "blocked") return s;
  return "unknown";
}

export function shouldImportFinding(f: ImportFinding): boolean {
  const cls = (f.finding_class ?? "vulnerability").toLowerCase();
  if (cls && cls !== "vulnerability") return false;
  // If class missing, allow when yaml present
  const poc = mapImportPocStatus(f.poc_status);
  // Keep same ingest set as live VH (pending allowed; failed blocked)
  if (poc === "failed" || poc === "blocked") return false;
  return true;
}

function parseScalar(line: string): string {
  let v = line.split(":").slice(1).join(":").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

/** Lightweight metadata extract from report.yaml header (no full YAML dep). */
export function extractReportMeta(yaml: string): {
  title: string | null;
  cwe: string | null;
  cvss_score: number | null;
  cvss_vector: string | null;
  severity: string | null;
  poc_status: string | null;
  finding_class: string | null;
  primary_file: string | null;
} {
  let title: string | null = null;
  let cwe: string | null = null;
  let cvss_score: number | null = null;
  let cvss_vector: string | null = null;
  let severity: string | null = null;
  let poc_status: string | null = null;
  let finding_class: string | null = null;
  let primary_file: string | null = null;
  let inAnchors = false;
  for (const raw of yaml.split(/\r?\n/).slice(0, 120)) {
    const line = raw;
    const t = line.trim();
    if (t.startsWith("anchors:")) {
      inAnchors = true;
      continue;
    }
    if (inAnchors && t.startsWith("file_path:") && !primary_file) {
      primary_file = parseScalar(t);
      inAnchors = false;
      continue;
    }
    if (t && !t.startsWith("-") && !line.startsWith(" ") && !line.startsWith("\t")) {
      // left metadata section
      if (inAnchors && !t.startsWith("file_path")) inAnchors = false;
    }
    if (t.startsWith("title:") && title == null) title = parseScalar(t);
    else if (t.startsWith("cwe:") && cwe == null) cwe = parseScalar(t);
    else if (t.startsWith("cvss_score:") && cvss_score == null) {
      const n = Number(parseScalar(t));
      if (Number.isFinite(n)) cvss_score = n;
    } else if (t.startsWith("cvss_vector:") && cvss_vector == null) {
      cvss_vector = parseScalar(t);
    } else if (t.startsWith("severity:") && severity == null) severity = parseScalar(t);
    else if (t.startsWith("poc_status:") && poc_status == null) poc_status = parseScalar(t);
    else if (t.startsWith("finding_class:") && finding_class == null) {
      finding_class = parseScalar(t);
    }
  }
  return {
    title,
    cwe,
    cvss_score,
    cvss_vector,
    severity,
    poc_status,
    finding_class,
    primary_file,
  };
}

function mapSeverity(f: ImportFinding, meta: ReturnType<typeof extractReportMeta>): SeverityStored {
  const score = f.cvss_score ?? meta.cvss_score;
  if (score != null) return severityFromCvss(score);
  const s = (f.severity ?? meta.severity ?? "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low" || s === "info") {
    return s;
  }
  return "info";
}

export function isTextArtifactPath(rel: string): boolean {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".zip") || lower.endsWith(".gz") || lower.endsWith(".tgz")) return false;
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return false;
  if (lower.endsWith(".bin") || lower.endsWith(".so") || lower.endsWith(".exe")) return false;
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return true; // no ext — treat as text
  return TEXT_EXT.has(lower.slice(dot));
}

export async function importFindingsPackage(body: ImportBody): Promise<{
  project_id: string;
  project_full_name: string;
  scan_job_id: string;
  imported: number;
  skipped: number;
}> {
  const cfg = loadConfig();
  if (!Array.isArray(body.findings) || body.findings.length === 0) {
    throw new Error("findings array required");
  }

  let project = body.project_id
    ? await projectStorage.findById(body.project_id)
    : null;

  if (!project) {
    if (!body.repo) throw new Error("repo or project_id required");
    const parsed = parseGitHubUrl(body.repo);
    if (!parsed) throw new Error(`invalid repo: ${body.repo}`);
    const { meta } = await resolveRootRepo(
      parsed.owner,
      parsed.repo,
      cfg.github.serverToken || undefined,
    );
    const existing = await projectStorage.findByRepoId(meta.id);
    if (existing) {
      project = existing;
    } else {
      project = await projectStorage.insertProject({
        githubRepoId: meta.id,
        ownerLogin: meta.owner.login,
        name: meta.name,
        fullName: meta.full_name,
        htmlUrl: meta.html_url,
        description: meta.description,
        language: meta.language,
        stars: meta.stargazers_count,
        defaultBranch: meta.default_branch,
      });
    }
  }

  let commitSha = body.commit_sha ?? null;
  if (!commitSha) {
    try {
      const [owner, name] = project.full_name.split("/");
      commitSha = await fetchDefaultBranchHeadSha(
        owner,
        name,
        project.default_branch || "main",
        cfg.github.serverToken || undefined,
      );
    } catch {
      commitSha = null;
    }
  }

  const accepted: ImportFinding[] = [];
  let skipped = 0;
  for (const f of body.findings) {
    if (!f.finding_key || !f.report_yaml) {
      skipped += 1;
      continue;
    }
    const meta = extractReportMeta(f.report_yaml);
    const merged: ImportFinding = {
      ...f,
      title: f.title ?? meta.title ?? f.finding_key,
      cwe: f.cwe ?? meta.cwe,
      primary_file: f.primary_file ?? meta.primary_file,
      cvss_score: f.cvss_score ?? meta.cvss_score,
      cvss_vector: f.cvss_vector ?? meta.cvss_vector,
      severity: f.severity ?? meta.severity,
      poc_status: f.poc_status ?? meta.poc_status,
      finding_class: f.finding_class ?? meta.finding_class,
    };
    if (!shouldImportFinding(merged)) {
      skipped += 1;
      continue;
    }
    accepted.push(merged);
  }

  const scanJobId = randomUUID();
  const db = getDb();

  await db.begin(async (tx) => {
    await tx`
      INSERT INTO scan_jobs (id, project_id, state, commit_sha, findings_so_far, started_at, finished_at)
      VALUES (
        ${scanJobId}::uuid,
        ${project!.id}::uuid,
        'completed',
        ${commitSha},
        ${accepted.length},
        now(),
        now()
      )
    `;

    // Clear prior findings for replace semantics (disclosure retain by key)
    const prior = await findingsStorage.listDisclosureByKey(project!.id, tx);
    await findingsStorage.deleteAllForProject(project!.id, tx);
    await artifactStorage.deleteArtifactsForProject(project!.id, tx);

    let publicCount = 0;
    for (const f of accepted) {
      const meta = extractReportMeta(f.report_yaml);
      const severity = mapSeverity(f, meta);
      if (severity !== "info") publicCount += 1;
      const findingId = randomUUID();
      const title = f.title ?? meta.title ?? f.finding_key;
      const primaryFile = f.primary_file ?? meta.primary_file;
      const pocStatus = mapImportPocStatus(f.poc_status ?? meta.poc_status);
      const prev = prior.get(f.finding_key);

      await findingsStorage.upsertEncryptedFinding(
        {
          id: findingId,
          projectId: project!.id,
          scanJobId,
          findingKey: f.finding_key,
          severity,
          cwe: f.cwe ?? meta.cwe,
          title,
          primaryFile,
          detailJson: {
            title,
            primary_file: primaryFile,
            detail: { source: "offline_import", report_yaml: f.report_yaml },
            report_yaml: f.report_yaml,
          },
          encPayload: "",
          disclosureState: prev?.state,
          disclosedAt: prev?.disclosedAt ?? null,
          disclosedTitle: prev?.disclosedTitle ?? title,
          disclosedSummary: prev?.disclosedSummary ?? null,
          disclosedReportYaml: prev?.disclosedReportYaml ?? f.report_yaml,
          cvssScore: f.cvss_score ?? meta.cvss_score,
          cvssVector: f.cvss_vector ?? meta.cvss_vector,
          pocStatus,
          itemType: "finding",
          vhSeverity: f.severity ?? meta.severity,
        },
        tx,
      );

      for (const a of f.artifacts ?? []) {
        if (!a.content || !isTextArtifactPath(a.rel_path)) continue;
        let text = a.content;
        let truncated = false;
        if (text.length > artifactStorage.ARTIFACT_CONTENT_MAX_CHARS) {
          text = text.slice(0, artifactStorage.ARTIFACT_CONTENT_MAX_CHARS);
          truncated = true;
        }
        const artifactId = randomUUID();
        await artifactStorage.insertArtifact(
          {
            id: artifactId,
            findingId,
            projectId: project!.id,
            scanJobId,
            kind: a.kind === "exp" ? "exp" : a.kind === "poc" ? "poc" : "other",
            relPath: a.rel_path.startsWith("findings/")
              ? a.rel_path
              : `findings/${f.finding_key}/${a.rel_path}`,
            fileName: a.file_name,
            mime: "text/plain",
            sizeBytes: Buffer.byteLength(a.content, "utf8"),
            encContent: null,
            contentText: text,
            truncated,
            isBinary: false,
          },
          tx,
        );
      }
    }

    await scanStorage.updateFindingsSoFar(scanJobId, publicCount, tx);
    await scanStorage.setCurrentScanJob(project!.id, scanJobId, tx);
  });

  logger.info(
    {
      projectId: project.id,
      fullName: project.full_name,
      imported: accepted.length,
      skipped,
      scanJobId,
    },
    "Offline import completed",
  );

  return {
    project_id: project.id,
    project_full_name: project.full_name,
    scan_job_id: scanJobId,
    imported: accepted.length,
    skipped,
  };
}
