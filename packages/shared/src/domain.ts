/**
 * Public-facing severity — NVD qualitative scale (v3.x).
 * info may exist in DB as engine fallback but is never exposed on public APIs.
 */
export type Severity = "critical" | "high" | "medium" | "low";

/** Includes storage-only info for internal use. */
export type SeverityStored = Severity | "info";

export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"] as const;

export const SEVERITY_NUMERIC: Record<SeverityStored, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

/**
 * NVD CVSS v3 qualitative mapping.
 * ≥9.0 critical · ≥7.0 high · ≥4.0 medium · >0 low · ≤0 / missing → info (hidden publicly)
 */
export function severityFromCvss(score: number | null | undefined): SeverityStored {
  if (score == null || Number.isNaN(score) || score <= 0) return "info";
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  return "low";
}

export function isPublicSeverity(s: string): s is Severity {
  return s === "critical" || s === "high" || s === "medium" || s === "low";
}

export type ScanJobState = "queued" | "dispatching" | "scanning" | "completed" | "failed";

export type DisclosureState = "owner_only" | "disclosed";

/**
 * Accepted poc_status values for ingestion.
 * Includes `pending`: real VH deep-judge findings stay pending until optional
 * PoC verification; public metrics count "found", not only PoC-confirmed.
 */
/** `reproduced` = VH deep-judge confirmed PoC (alias of confirmed). */
export const POC_STATUS_INGEST = [
  "confirmed",
  "reproduced",
  "not-needed",
  "unknown",
  "pending",
] as const;
export type PocStatusIngest = (typeof POC_STATUS_INGEST)[number];

export function isIngestiblePocStatus(s: string | null | undefined): boolean {
  if (!s) return true; // missing → treat as unknown (ingest)
  return (POC_STATUS_INGEST as readonly string[]).includes(s.toLowerCase());
}
