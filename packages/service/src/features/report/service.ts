import JSZip from "jszip";
import type { Severity, SeverityCounts } from "@openvuln/shared";
import { getDb } from "../../infra/db/index.js";
import { AppError } from "../../middleware/error-handler.js";
import { isUuid } from "../findings/storage.js";

export type ReportFormat = "markdown" | "json" | "zip";

export interface DisclosedFindingPublic {
  finding_key: string;
  severity: Severity;
  title: string;
  cwe: string | null;
  disclosed_at: string | null;
}

export interface PublicReport {
  generated_at: string;
  project: {
    id: string;
    full_name: string;
    html_url: string;
    description: string | null;
    default_branch: string;
  };
  latest_scan: {
    finished_at: string | null;
    commit_sha: string | null;
    state: string | null;
  } | null;
  severity_summary: SeverityCounts;
  disclosed_count: number;
  findings: DisclosedFindingPublic[];
}

export interface SingleFindingReport {
  generated_at: string;
  project: PublicReport["project"];
  latest_scan: PublicReport["latest_scan"];
  finding: DisclosedFindingPublic;
}

function emptyCounts(): SeverityCounts {
  return { high: 0, medium: 0, low: 0, info: 0 };
}

function slugify(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

async function loadProjectMeta(projectId: string): Promise<PublicReport["project"]> {
  if (!isUuid(projectId)) {
    throw new AppError("ERR_VALIDATION", { field: "id", reason: "invalid_uuid" });
  }
  const db = getDb();
  const projects = await db<
    {
      id: string;
      full_name: string;
      html_url: string;
      description: string | null;
      default_branch: string;
    }[]
  >`
    SELECT id::text, full_name, html_url, description, default_branch
    FROM projects
    WHERE id = ${projectId}::uuid AND removed_at IS NULL
  `;
  if (projects.length === 0) {
    throw new AppError("ERR_NOT_FOUND", { resource: "project" });
  }
  return projects[0];
}

async function loadLatestScan(projectId: string): Promise<PublicReport["latest_scan"]> {
  const db = getDb();
  const scans = await db<
    { finished_at: Date | null; commit_sha: string | null; state: string }[]
  >`
    SELECT finished_at, commit_sha, state
    FROM scan_jobs
    WHERE project_id = ${projectId}::uuid
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const scan = scans[0];
  if (!scan) return null;
  return {
    finished_at: scan.finished_at?.toISOString() ?? null,
    commit_sha: scan.commit_sha,
    state: scan.state,
  };
}

/** RED LINE: only disclosed rows; never select path/code/detail_json. */
async function loadDisclosedFindings(projectId: string): Promise<DisclosedFindingPublic[]> {
  const db = getDb();
  const findings = await db<
    {
      finding_key: string;
      severity: Severity;
      title: string;
      cwe: string | null;
      disclosed_at: Date | null;
    }[]
  >`
    SELECT finding_key, severity, title, cwe, disclosed_at
    FROM findings
    WHERE project_id = ${projectId}::uuid
      AND disclosure_state = 'disclosed'
    ORDER BY
      CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      disclosed_at DESC NULLS LAST,
      title ASC
  `;
  return findings.map((f) => ({
    finding_key: f.finding_key,
    severity: f.severity,
    title: f.title,
    cwe: f.cwe,
    disclosed_at: f.disclosed_at?.toISOString() ?? null,
  }));
}

export async function buildPublicReport(projectId: string): Promise<PublicReport> {
  const project = await loadProjectMeta(projectId);
  const latest_scan = await loadLatestScan(projectId);
  const findings = await loadDisclosedFindings(projectId);

  const severity_summary = emptyCounts();
  for (const f of findings) severity_summary[f.severity] += 1;

  return {
    generated_at: new Date().toISOString(),
    project,
    latest_scan,
    severity_summary,
    disclosed_count: findings.length,
    findings,
  };
}

export async function buildSingleFindingReport(
  projectId: string,
  findingKey: string,
): Promise<SingleFindingReport> {
  if (!findingKey || findingKey.length > 256) {
    throw new AppError("ERR_VALIDATION", { field: "findingKey" });
  }
  const project = await loadProjectMeta(projectId);
  const latest_scan = await loadLatestScan(projectId);
  const db = getDb();

  // RED LINE: disclosed only
  const rows = await db<
    {
      finding_key: string;
      severity: Severity;
      title: string;
      cwe: string | null;
      disclosed_at: Date | null;
    }[]
  >`
    SELECT finding_key, severity, title, cwe, disclosed_at
    FROM findings
    WHERE project_id = ${projectId}::uuid
      AND finding_key = ${findingKey}
      AND disclosure_state = 'disclosed'
  `;
  if (rows.length === 0) {
    // Distinguish not disclosed vs missing — both 404 to avoid leaking existence of owner_only
    throw new AppError("ERR_NOT_FOUND", { resource: "finding" });
  }
  const f = rows[0];
  return {
    generated_at: new Date().toISOString(),
    project,
    latest_scan,
    finding: {
      finding_key: f.finding_key,
      severity: f.severity,
      title: f.title,
      cwe: f.cwe,
      disclosed_at: f.disclosed_at?.toISOString() ?? null,
    },
  };
}

export function renderMarkdown(report: PublicReport): string {
  const { project, latest_scan, severity_summary, findings } = report;
  const lines: string[] = [];

  lines.push(`# OpenVuln Disclosure Report`);
  lines.push(``);
  lines.push(`**Project:** [${project.full_name}](${project.html_url})`);
  if (project.description) {
    lines.push(`**Description:** ${project.description}`);
  }
  lines.push(`**Default branch:** \`${project.default_branch}\``);
  if (latest_scan?.finished_at) {
    lines.push(`**Scan completed:** ${latest_scan.finished_at.slice(0, 10)}`);
  }
  if (latest_scan?.commit_sha) {
    lines.push(`**Commit:** \`${latest_scan.commit_sha}\``);
  }
  lines.push(`**Generated:** ${report.generated_at}`);
  lines.push(``);
  lines.push(`## Severity summary`);
  lines.push(``);
  lines.push(`| Severity | Count |`);
  lines.push(`|---|---:|`);
  for (const sev of ["high", "medium", "low", "info"] as const) {
    lines.push(`| ${sev} | ${severity_summary[sev]} |`);
  }
  lines.push(``);
  lines.push(`## Disclosed findings (${report.disclosed_count})`);
  lines.push(``);

  if (findings.length === 0) {
    lines.push(`_No findings have been disclosed for this project._`);
    lines.push(``);
  } else {
    lines.push(`| Severity | Title | CWE | Disclosed | Key |`);
    lines.push(`|---|---|---|---|---|`);
    for (const f of findings) {
      const title = f.title.replace(/\|/g, "\\|");
      const cwe = f.cwe ?? "—";
      const when = f.disclosed_at ? f.disclosed_at.slice(0, 10) : "—";
      lines.push(`| ${f.severity} | ${title} | ${cwe} | ${when} | \`${f.finding_key}\` |`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(
    `_Report generated by [OpenVuln](https://github.com/Clouditera/OpenVuln) · Powered by VulnHunter_`,
  );
  lines.push(``);
  return lines.join("\n");
}

export function renderSingleMarkdown(report: SingleFindingReport): string {
  const { project, latest_scan, finding: f } = report;
  const lines: string[] = [];
  lines.push(`# ${f.title}`);
  lines.push(``);
  lines.push(`**Project:** [${project.full_name}](${project.html_url})`);
  lines.push(`**Severity:** ${f.severity}`);
  lines.push(`**CWE:** ${f.cwe ?? "—"}`);
  if (f.disclosed_at) {
    lines.push(`**Disclosed:** ${f.disclosed_at.slice(0, 10)}`);
  }
  lines.push(`**Finding key:** \`${f.finding_key}\``);
  if (latest_scan?.commit_sha) {
    lines.push(`**Scan commit:** \`${latest_scan.commit_sha}\``);
  }
  if (latest_scan?.finished_at) {
    lines.push(`**Scan completed:** ${latest_scan.finished_at.slice(0, 10)}`);
  }
  lines.push(`**Generated:** ${report.generated_at}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(
    `_Single-finding report by [OpenVuln](https://github.com/Clouditera/OpenVuln) · Powered by VulnHunter_`,
  );
  lines.push(``);
  lines.push(
    `_This report contains only publicly disclosed fields. File paths and code snippets are not included._`,
  );
  lines.push(``);
  return lines.join("\n");
}

export async function buildZipBundle(report: PublicReport): Promise<Uint8Array> {
  const zip = new JSZip();
  const folderName = slugify(report.project.full_name);

  zip.file("index.md", renderMarkdown(report));
  zip.file(
    "index.json",
    JSON.stringify(
      {
        generated_at: report.generated_at,
        project: report.project,
        latest_scan: report.latest_scan,
        severity_summary: report.severity_summary,
        disclosed_count: report.disclosed_count,
        findings: report.findings,
      },
      null,
      2,
    ),
  );

  const findingsDir = zip.folder("findings");
  if (findingsDir) {
    for (const f of report.findings) {
      const single: SingleFindingReport = {
        generated_at: report.generated_at,
        project: report.project,
        latest_scan: report.latest_scan,
        finding: f,
      };
      const base = `${slugify(f.severity)}-${slugify(f.finding_key)}`;
      findingsDir.file(`${base}.md`, renderSingleMarkdown(single));
      findingsDir.file(`${base}.json`, JSON.stringify(single, null, 2));
    }
  }

  // README for consumers
  zip.file(
    "README.md",
    [
      `# ${report.project.full_name} — disclosed findings bundle`,
      ``,
      `- \`index.md\` / \`index.json\` — full summary`,
      `- \`findings/\` — one Markdown + JSON file per disclosed finding`,
      ``,
      `Generated ${report.generated_at} by OpenVuln. Public fields only.`,
      ``,
    ].join("\n"),
  );

  void folderName;
  const buf = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return buf;
}

export function filenameFor(report: PublicReport, format: ReportFormat): string {
  const slug = slugify(report.project.full_name);
  const day = report.generated_at.slice(0, 10);
  if (format === "zip") return `openvuln-${slug}-disclosed-${day}.zip`;
  if (format === "json") return `openvuln-${slug}-disclosed-${day}.json`;
  return `openvuln-${slug}-disclosed-${day}.md`;
}

export function singleFilenameFor(report: SingleFindingReport, format: "markdown" | "json"): string {
  const slug = slugify(report.project.full_name);
  const key = slugify(report.finding.finding_key);
  const ext = format === "json" ? "json" : "md";
  return `openvuln-${slug}-${key}.${ext}`;
}
