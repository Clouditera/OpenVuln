/** VulnHunter client interface — switch point for cookie/token/mock. */

export type VhTaskState =
  | "queued"
  | "preparing"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export interface VhFindingMeta {
  key: string;
  severity: string;
  title?: string;
  cwe?: string | null;
  primary_file?: string | null;
  [extra: string]: unknown;
}

export interface VulnHunterClient {
  createScanTask(input: { gitUrl: string; displayName: string }): Promise<{ taskId: string }>;
  getTask(taskId: string): Promise<{ state: VhTaskState }>;
  listFindings(taskId: string): Promise<VhFindingMeta[]>;
  getFindingDetail(taskId: string, key: string): Promise<unknown>;
  healthCheck(): Promise<boolean>;
}
