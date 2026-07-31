import type { DisclosureState, Severity } from "../domain.js";

export interface FindingListItem {
  id: string;
  finding_key: string;
  severity: Severity;
  title: string;
  cwe: string | null;
  primary_file: string | null;
  disclosure_state: DisclosureState;
  disclosed_at: string | null;
}

export interface FindingListResponse {
  items: FindingListItem[];
}

export interface FindingDetail extends FindingListItem {
  detail: unknown;
  scan_job_id: string;
  project_id: string;
}

export interface DiscloseRequest {
  finding_ids: string[];
}

export interface DiscloseResponse {
  disclosed_count: number;
  finding_ids: string[];
}
