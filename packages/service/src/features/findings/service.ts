import type { DiscloseResponse, FindingDetail, FindingListResponse } from "@openvuln/shared";
import { AppError } from "../../middleware/error-handler.js";
import * as storage from "./storage.js";

export async function listOwnerFindings(projectId: string): Promise<FindingListResponse> {
  const items = await storage.listForOwner(projectId);
  return {
    items: items.map((f) => ({
      id: f.id,
      finding_key: f.finding_key,
      severity: f.severity,
      title: f.title,
      cwe: f.cwe,
      primary_file: f.primary_file,
      disclosure_state: f.disclosure_state,
      disclosed_at: f.disclosed_at?.toISOString() ?? null,
    })),
  };
}

export async function getOwnerFinding(projectId: string, key: string): Promise<FindingDetail> {
  const f = await storage.getForOwner(projectId, key);
  if (!f) throw new AppError("ERR_NOT_FOUND", { resource: "finding" });
  return {
    id: f.id,
    finding_key: f.finding_key,
    severity: f.severity,
    title: f.title,
    cwe: f.cwe,
    primary_file: f.primary_file,
    disclosure_state: f.disclosure_state,
    disclosed_at: f.disclosed_at?.toISOString() ?? null,
    detail: f.detail_json,
    scan_job_id: f.scan_job_id,
    project_id: f.project_id,
  };
}

export async function disclose(
  projectId: string,
  findingIds: string[],
  byGithubUserId: number,
): Promise<DiscloseResponse> {
  if (!Array.isArray(findingIds) || findingIds.length === 0) {
    throw new AppError("ERR_VALIDATION", { field: "finding_ids" });
  }
  if (findingIds.length > 200) {
    throw new AppError("ERR_VALIDATION", { field: "finding_ids", reason: "too_many" });
  }
  // BUG-3: reject non-uuid ids with 422 instead of letting PG throw 500
  const invalid = findingIds.filter((id) => typeof id !== "string" || !storage.isUuid(id));
  if (invalid.length > 0) {
    throw new AppError("ERR_VALIDATION", {
      field: "finding_ids",
      reason: "invalid_uuid",
      invalid_ids: invalid.slice(0, 5),
    });
  }
  const ids = await storage.discloseFindings(projectId, findingIds, byGithubUserId);
  return { disclosed_count: ids.length, finding_ids: ids };
}
