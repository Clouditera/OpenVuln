import type { ScanJobState, Severity } from "../domain.js";

/** Severity counts for public aggregation (NVD four tiers, no info). */
export type SeverityCounts = Record<Severity, number>;

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

export interface ProjectCard {
  id: string;
  owner_login: string;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stars: number;
  default_branch: string;
  latest_scan: {
    id: string;
    state: ScanJobState;
    commit_sha: string | null;
    created_at: string;
    finished_at: string | null;
    findings_so_far?: number;
  } | null;
  severity_counts: SeverityCounts;
  created_at: string;
}

export interface ProjectListResponse {
  items: ProjectCard[];
  page: number;
  page_size: number;
  total: number;
}

export interface CweCount {
  cwe: string;
  count: number;
}

export interface DisclosedFindingSummary {
  id: string;
  finding_key: string;
  severity: Severity;
  title: string;
  cwe: string | null;
  disclosed_at: string | null;
  /** Short operator note (optional). */
  summary?: string | null;
  /**
   * Structured report parsed from original report.yaml (disclosed + fidelity only).
   * Prefer this for Details UI. Raw yaml available via download ?format=yaml.
   */
  report?: {
    metadata: Record<string, unknown>;
    description: Record<string, unknown>;
    code: Record<string, unknown>;
    references: unknown;
  } | null;
}

export interface ProjectPublicView {
  id: string;
  owner_login: string;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stars: number;
  default_branch: string;
  latest_scan: {
    id: string;
    state: ScanJobState;
    commit_sha: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    findings_so_far?: number;
  } | null;
  severity_counts: SeverityCounts;
  cwe_distribution: CweCount[];
  /** Only disclosed findings appear here for anonymous users. */
  disclosed_findings: DisclosedFindingSummary[];
  created_at: string;
}

export interface SubmitProjectRequest {
  git_url: string;
  /** 可选版本：branch / tag / 完整 commit SHA（默认=默认分支 HEAD，提交时锁定）。 */
  ref?: string;
}

export interface SubmitProjectResponse {
  project: ProjectCard;
}
