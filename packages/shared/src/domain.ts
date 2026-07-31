/** Severity aligns with VulnHunter (no critical). */
export type Severity = "high" | "medium" | "low" | "info";

export const SEVERITIES: readonly Severity[] = ["high", "medium", "low", "info"] as const;

export const SEVERITY_NUMERIC: Record<Severity, number> = {
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export type ScanJobState = "queued" | "dispatching" | "scanning" | "completed" | "failed";

export type DisclosureState = "owner_only" | "disclosed";

export type RepoAccessRole = "admin" | "maintain";
