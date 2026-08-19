import { describe, expect, it } from "vitest";
import { scanQueueInternal } from "./index.js";

describe("mapFindingSeverity (NVD)", () => {
  const map = scanQueueInternal.mapFindingSeverity;

  it("maps CVSS scores to NVD tiers", () => {
    expect(map({ key: "a", cvss_score: 9.8 }, null).severity).toBe("critical");
    expect(map({ key: "a", cvss_score: 8.1 }, null).severity).toBe("high");
    expect(map({ key: "a", cvss_score: 5.0 }, null).severity).toBe("medium");
    expect(map({ key: "a", cvss_score: 2.1 }, null).severity).toBe("low");
    expect(map({ key: "a", cvss_score: 0 }, null).severity).toBe("info");
  });

  it("falls back to VH label when no score", () => {
    expect(map({ key: "a", severity: "high" }, null).severity).toBe("high");
    expect(map({ key: "a", severity: "critical" }, null).severity).toBe("critical");
  });
});

describe("isNoScanValueFailure", () => {
  const fn = scanQueueInternal.isNoScanValueFailure;

  it("matches Chinese incomplete-source reason and metadata flags", () => {
    expect(
      fn("Error: 源码不完整：功能代码缺失，无法建立完整的代码功能语义。", null),
    ).toBe(true);
    expect(fn("other", { source_incomplete: true })).toBe(true);
    expect(fn(null, { prepare: { reason: "partial_source" } })).toBe(true);
    expect(fn(null, { prepare: { reason: "incomplete_source" } })).toBe(true);
  });

  it("does not match ordinary failures", () => {
    expect(fn("worker OOM killed", null)).toBe(false);
    expect(fn("timeout", { prepare: { reason: "sandbox_error" } })).toBe(false);
  });

  it("sandbox/capacity prepare failures are NOT no-value (task-614cf34a)", () => {
    // Exact sonic production shape: ERR_PREPARE_FAILED + sandbox_unavailable +
    // project_complete:false riding along. Must be false → ordinary failed, retryable.
    expect(
      fn(
        JSON.stringify({
          code: "ERR_PREPARE_FAILED",
          message: "沙箱服务容量不足",
          details: { phase: "prepare", reason: "sandbox_unavailable", detail: "沙箱服务容量不足" },
        }),
        {
          prepare: {
            reason: "sandbox_unavailable",
            project_complete: false,
          },
        },
      ),
    ).toBe(false);
    expect(fn(null, { prepare: { reason: "sandbox_unavailable", project_complete: false } })).toBe(
      false,
    );
    expect(fn("沙箱服务容量不足", { prepare: { project_complete: false } })).toBe(false);
    expect(fn("ERR_PREPARE_FAILED", null)).toBe(false);
  });

  it("bare project_complete:false without prepare.reason only counts when text is content-like", () => {
    // content-like text → no-value
    expect(fn("源码不完整", { prepare: { project_complete: false } })).toBe(true);
    // infra-like text → not no-value
    expect(fn("sandbox service unavailable", { prepare: { project_complete: false } })).toBe(
      false,
    );
  });
});

describe("shouldIngestFinding", () => {
  const ok = scanQueueInternal.shouldIngestFinding;

  it("accepts finding + confirmed/not-needed/unknown/pending", () => {
    expect(ok({ key: "a", item_type: "finding", poc_status: "confirmed" }, null)).toBe(true);
    expect(ok({ key: "a", item_type: "finding", poc_status: "reproduced" }, null)).toBe(true);
    expect(ok({ key: "a", item_type: "finding", poc_status: "not-needed" }, null)).toBe(true);
    expect(ok({ key: "a", item_type: "finding", poc_status: "unknown" }, null)).toBe(true);
    expect(ok({ key: "a", item_type: "finding", poc_status: "pending" }, null)).toBe(true);
    expect(ok({ key: "a", item_type: "finding" }, null)).toBe(true);
  });

  it("rejects risk and failed/blocked poc", () => {
    expect(ok({ key: "a", item_type: "risk", poc_status: "confirmed" }, null)).toBe(false);
    expect(ok({ key: "a", item_type: "risk", poc_status: "not-needed" }, null)).toBe(false);
    expect(ok({ key: "a", item_type: "finding", poc_status: "failed" }, null)).toBe(false);
    expect(ok({ key: "a", item_type: "finding", poc_status: "blocked" }, null)).toBe(false);
  });
});
