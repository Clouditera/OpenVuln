import type { ScanJobState, Severity } from "../domain.js";

/** Severity counts for public aggregation. */
export type SeverityCounts = Record<Severity, number>;

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
  } | null;
  severity_counts: SeverityCounts;
  cwe_distribution: CweCount[];
  /** Only disclosed findings appear here for anonymous users. */
  disclosed_findings: DisclosedFindingSummary[];
  created_at: string;
}

export interface SubmitProjectRequest {
  git_url: string;
}

export interface SubmitProjectResponse {
  project: ProjectCard;
}
