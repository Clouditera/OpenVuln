import type { ScanJobState } from "../domain.js";

export interface QueueItem {
  id: string;
  project_id: string;
  project_full_name: string;
  state: ScanJobState;
  vulnhunter_task_id: string | null;
  attempt: number;
  fail_reason_internal: string | null;
  /** Archive-filter audit (task-08627338) */
  skipped_entries?: { count: number; entries: string[] } | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface QueueResponse {
  items: QueueItem[];
  /** Paged listing (task-99f770f3) */
  total?: number;
  page?: number;
  page_size?: number;
}
