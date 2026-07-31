import { describe, expect, it } from "vitest";
import { scanQueueInternal } from "./index.js";

describe("normalizeSeverity", () => {
  const n = scanQueueInternal.normalizeSeverity;
  it("passes through known values", () => {
    expect(n("high")).toBe("high");
    expect(n("MEDIUM")).toBe("medium");
    expect(n("low")).toBe("low");
    expect(n("info")).toBe("info");
  });
  it("maps critical → high", () => {
    expect(n("critical")).toBe("high");
  });
  it("defaults unknown to info", () => {
    expect(n(undefined)).toBe("info");
    expect(n("weird")).toBe("info");
  });
});
