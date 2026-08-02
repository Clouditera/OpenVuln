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

describe("shouldIngestFinding", () => {
  const ok = scanQueueInternal.shouldIngestFinding;

  it("accepts finding + confirmed/not-needed/unknown/pending", () => {
    expect(ok({ key: "a", item_type: "finding", poc_status: "confirmed" }, null)).toBe(true);
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
