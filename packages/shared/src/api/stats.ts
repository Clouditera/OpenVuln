import type { SeverityCounts } from "./projects.js";

export interface TrendDay {
  date: string; // YYYY-MM-DD
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface CweTopItem {
  cwe: string;
  name: string | null;
  count: number;
}

export interface LiveScanItem {
  project_id: string;
  full_name: string;
  state: "scanning" | "dispatching";
  elapsed_sec: number;
  findings_so_far: number;
}

export interface RecentActivityItem {
  ts: string;
  type: "scan_completed" | "project_submitted" | "scan_failed" | "disclosed";
  text: string;
  full_name?: string;
  meta?: string;
}

export interface OverviewStats {
  project_count: number;
  /** Distinct active repositories with at least one completed scan. */
  scanned_project_count?: number;
  scan_completed_count: number;
  scan_failed_count: number;
  scan_in_progress_count: number;
  /** Public findings found (NVD four tiers; excludes info). */
  finding_total: number;
  finding_disclosed_count: number;
  severity_counts: SeverityCounts;
  /** Optional extended fields (pulse / live). */
  trend?: TrendDay[];
  cwe_top?: CweTopItem[];
  live?: {
    scanning: LiveScanItem[];
    queued_count: number;
  };
  recent?: RecentActivityItem[];
}
