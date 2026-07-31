import type { SeverityCounts } from "./projects.js";

export interface TrendDay {
  date: string; // YYYY-MM-DD
  high: number;
  medium: number;
  low: number;
  info: number;
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
  scan_completed_count: number;
  scan_failed_count: number;
  scan_in_progress_count: number;
  finding_total: number;
  finding_disclosed_count: number;
  severity_counts: SeverityCounts;
  /** Optional extended pulse fields (v1.2 dashboard). */
  poc_rate?: number;
  cwe_count?: number;
  trend?: TrendDay[];
  cwe_top?: CweTopItem[];
  live?: {
    scanning: LiveScanItem[];
    queued_count: number;
  };
  recent?: RecentActivityItem[];
}
