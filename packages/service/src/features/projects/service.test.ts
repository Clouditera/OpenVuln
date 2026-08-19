import { describe, expect, it } from "vitest";
import { toPublicScanState } from "./service.js";

describe("toPublicScanState (fish No.2016 / task-614cf34a)", () => {
  it("masks failed as scanning", () => {
    expect(toPublicScanState("failed")).toBe("scanning");
  });

  it("passes through non-failed states", () => {
    for (const s of [
      "pending_review",
      "queued",
      "dispatching",
      "scanning",
      "completed",
      "cancelled",
      "rejected",
    ]) {
      expect(toPublicScanState(s)).toBe(s);
    }
  });
});
