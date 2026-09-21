import { describe, expect, it } from "vitest";
import {
  combinations,
  minimumDetectableEffect,
  MIN_NOISE_DF,
  pooledWithinSd,
  pValueFloor,
} from "../src/power.js";

describe("combinations", () => {
  it("uses exact integer arithmetic", () => {
    expect(combinations(6, 3)).toBe(20);
    expect(combinations(8, 4)).toBe(70);
    expect(combinations(10, 5)).toBe(252);
    expect(combinations(12, 6)).toBe(924);
    expect(Number.isInteger(combinations(12, 6))).toBe(true);
  });

  it("handles the degenerate edges", () => {
    expect(combinations(6, 0)).toBe(1);
    expect(combinations(6, 6)).toBe(1);
    expect(combinations(6, 7)).toBe(0);
  });
});

describe("pValueFloor", () => {
  it("matches the exact worked table for balanced designs", () => {
    expect(pValueFloor(6, 3)).toBeCloseTo(0.05, 10);
    expect(pValueFloor(8, 4)).toBeCloseTo(0.0142857142857, 10);
    expect(pValueFloor(10, 5)).toBeCloseTo(0.0039682539683, 10);
    expect(pValueFloor(12, 6)).toBeCloseTo(0.0010822510823, 10);
  });

  it("hits exactly 0.05 at 6 blocks, the reason 6 is the minimum", () => {
    expect(pValueFloor(6, 3)).toBe(0.05);
  });
});

describe("minimumDetectableEffect", () => {
  it("matches the theanine worked example within tolerance", () => {
    const mde = minimumDetectableEffect({
      assumedWithinSd: 1.5,
      blockLengthDays: 5,
      numActive: 3,
      numBlank: 3,
    });
    expect(mde).toBeCloseTo(1.36, 2);
    expect(Math.round(mde * 10) / 10).toBe(1.4);
  });

  it("shrinks as block count rises (more blocks detect a smaller effect)", () => {
    const six = minimumDetectableEffect({ assumedWithinSd: 1.5, blockLengthDays: 5, numActive: 3, numBlank: 3 });
    const ten = minimumDetectableEffect({ assumedWithinSd: 1.5, blockLengthDays: 5, numActive: 5, numBlank: 5 });
    expect(ten).toBeLessThan(six);
  });

  it("shrinks as block length rises (more days per block detect a smaller effect)", () => {
    const short = minimumDetectableEffect({ assumedWithinSd: 1.5, blockLengthDays: 5, numActive: 3, numBlank: 3 });
    const long = minimumDetectableEffect({ assumedWithinSd: 1.5, blockLengthDays: 10, numActive: 3, numBlank: 3 });
    expect(long).toBeLessThan(short);
  });
});

describe("pooledWithinSd", () => {
  it("returns the pooled within-block SD for known vectors", () => {
    // Five two-value blocks, each SS = 2, df = 1: pooled SD = sqrt(10 / 5).
    expect(pooledWithinSd([[6, 8], [2, 4], [1, 3], [9, 11], [0, 2]])).toBeCloseTo(
      Math.sqrt(2),
      6
    );
  });

  it("skips a block with fewer than two values", () => {
    // The singleton adds no deviation and no df, so the result matches the same
    // vectors without it.
    const withSingleton = pooledWithinSd([[6, 8], [5], [2, 4], [1, 3], [9, 11], [0, 2]]);
    const withoutSingleton = pooledWithinSd([[6, 8], [2, 4], [1, 3], [9, 11], [0, 2]]);
    expect(withSingleton).not.toBeNull();
    expect(withSingleton).toBeCloseTo(withoutSingleton as number, 12);
  });

  it("returns null when the pooled df falls below MIN_NOISE_DF", () => {
    expect(MIN_NOISE_DF).toBe(4);
    // Two two-value blocks give df = 2, under the floor of 4.
    expect(pooledWithinSd([[6, 8], [2, 4]])).toBeNull();
    // A single two-value block gives df = 1.
    expect(pooledWithinSd([[6, 8]])).toBeNull();
  });

  it("returns null when every value is equal (zero spread)", () => {
    expect(pooledWithinSd([[5, 5, 5], [5, 5, 5], [5, 5, 5]])).toBeNull();
  });
});
