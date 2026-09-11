import { describe, expect, it } from "vitest";
import { blocklistMatch } from "../src/safety/blocklist.js";

describe("blocklistMatch", () => {
  it("matches a known prescription drug, case-insensitively", () => {
    expect(blocklistMatch("sertraline")).toBe("sertraline");
    expect(blocklistMatch("Zoloft")).toBe("zoloft");
    expect(blocklistMatch("  ADDERALL  ")).toBe("adderall");
  });

  it("does not match plausible supplements", () => {
    expect(blocklistMatch("theanine")).toBeNull();
    expect(blocklistMatch("vitamin d")).toBeNull();
    expect(blocklistMatch("magnesium glycinate")).toBeNull();
    expect(blocklistMatch("creatine")).toBeNull();
  });

  it("matches on a whole word only, never a bare substring", () => {
    // "codeine" is a term; a longer unrelated word must not trip it.
    expect(blocklistMatch("supercodeiner")).toBeNull();
    // But the drug named among other words still matches.
    expect(blocklistMatch("morning dose of codeine")).toBe("codeine");
  });

  it("returns null for empty input", () => {
    expect(blocklistMatch("")).toBeNull();
    expect(blocklistMatch("   ")).toBeNull();
  });
});
