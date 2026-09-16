import { describe, expect, it } from "vitest";
import {
  binomialTestVsChance,
  computeVerdict,
  luckPhrase,
  permutationTest,
  round1,
  type VerdictAllocation,
  type VerdictCheckIn,
  type VerdictInput,
} from "../src/verdict.js";
import type { MetricDirection, MetricType } from "../src/metrics.js";

// Pure engine tests: no app, no DB. The verdict is deterministic arithmetic.

const START = "2026-07-01";

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Cond = "active" | "placebo";

function buildBlocks(conditions: Cond[], len = 7): VerdictAllocation[] {
  return conditions.map((condition, i) => ({
    condition,
    block_start_date: addDaysIso(START, i * len),
    block_end_date: addDaysIso(START, i * len + len - 1),
  }));
}

interface CheckOpts {
  values: number[]; // one per block
  guesses: Array<"active" | "placebo" | "unsure">; // one per block
  includeBlock?: (i: number) => boolean;
  len?: number;
}

function buildCheckIns(blocks: VerdictAllocation[], opts: CheckOpts): VerdictCheckIn[] {
  const len = opts.len ?? 7;
  const include = opts.includeBlock ?? (() => true);
  const cs: VerdictCheckIn[] = [];
  blocks.forEach((b, i) => {
    if (!include(i)) return;
    for (let d = 0; d < len; d++) {
      cs.push({
        check_date: addDaysIso(b.block_start_date, d),
        metric_value: opts.values[i],
        placebo_guess: opts.guesses[i],
      });
    }
  });
  return cs;
}

function makeInput(
  conditions: Cond[],
  checkIns: VerdictCheckIn[],
  overrides: Partial<VerdictInput> = {}
): VerdictInput {
  const metric_type: MetricType = overrides.metric_type ?? "rating_0_10";
  const metric_direction: MetricDirection = overrides.metric_direction ?? "higher_better";
  return {
    substance_name: "Magnesium",
    metric_name: "Sleep quality",
    metric_type,
    metric_direction,
    block_length_days: 7,
    num_blocks: conditions.length,
    num_active_blocks: conditions.filter((c) => c === "active").length,
    run_length_days: conditions.length * 7,
    allocations: buildBlocks(conditions),
    check_ins: checkIns,
    ...overrides,
  };
}

describe("permutationTest", () => {
  it("floor case: the single most-extreme labeling gives p = 1/20 and never less", () => {
    const res = permutationTest([8, 8, 8, 2, 2, 2], 3, "higher_better");
    expect(res.p_value).toBeCloseTo(0.05, 10);
    expect(res.floor).toBeCloseTo(0.05, 10);
    // No smaller p is possible for six balanced blocks.
    expect(res.p_value).toBeGreaterThanOrEqual(res.floor - 1e-12);
  });

  it("hand-computed mixed case: p = 5/20 higher_better, 19/20 lower_better", () => {
    const higher = permutationTest([5, 6, 7, 4, 5, 6], 3, "higher_better");
    expect(higher.p_value).toBeCloseTo(0.25, 10);
    const lower = permutationTest([5, 6, 7, 4, 5, 6], 3, "lower_better");
    expect(lower.p_value).toBeCloseTo(0.95, 10);
  });

  it("no signal: identical block means give p = 1.0", () => {
    const res = permutationTest([4, 4, 4, 4, 4, 4], 3, "higher_better");
    expect(res.p_value).toBeCloseTo(1.0, 10);
  });
});

describe("binomialTestVsChance", () => {
  it("P(X >= 3 | n = 6) = 42/64 exactly", () => {
    expect(binomialTestVsChance(3, 6)).toBeCloseTo(42 / 64, 12);
  });

  it("P(X >= 17 | n = 21) is about 0.0036", () => {
    expect(binomialTestVsChance(17, 21)).toBeCloseTo(0.0036, 4);
  });

  it("n = 0 has no test", () => {
    expect(binomialTestVsChance(0, 0)).toBeNull();
  });
});

describe("luckPhrase", () => {
  it("formats whole and fractional percents and the tiny-number floor", () => {
    expect(luckPhrase(0.05)).toBe("about 5% of the time");
    expect(luckPhrase(0.25)).toBe("about 25% of the time");
    expect(luckPhrase(0.0036)).toBe("about 0.4% of the time");
    expect(luckPhrase(0.0004)).toBe("fewer than 1 time in 1000");
  });
});

describe("computeVerdict", () => {
  const activeFirst: Cond[] = ["active", "active", "active", "placebo", "placebo", "placebo"];

  it("full data, significant effect, guesses beat chance (verbatim text)", () => {
    const blocks = buildBlocks(activeFirst);
    const checkIns = buildCheckIns(blocks, {
      values: [8, 8, 8, 2, 2, 2],
      guesses: ["active", "active", "active", "placebo", "placebo", "placebo"],
    });
    const v = computeVerdict(makeInput(activeFirst, checkIns));

    expect(v.effect_estimate).toBe(6);
    expect(v.effect_units).toBe("points");
    expect(v.permutation_p_value).toBeCloseTo(0.05, 10);
    expect(v.p_value_floor).toBeCloseTo(0.05, 10);
    expect(v.days_logged).toBe(42);
    expect(v.adherence_pct).toBe(100);
    expect(v.blind_integrity_flag).toBe(true);
    expect(v.guess_days_scored).toBe(42);
    expect(v.guess_days_correct).toBe(42);
    expect(v.verdict_text).toBe(
      "Magnesium moved your Sleep quality. Supplement days ran about 6 points higher than blank days. Luck alone does that about 5% of the time."
    );
    expect(v.guess_text).toBe(
      "You felt it. You guessed right on 42 of 42 days. A coin gets about half."
    );
    expect(v.power_note).toBe(
      'A run this size can reliably notice a change of about 1.2 points or larger, given a typical amount of day-to-day noise. With 6 blocks, the strongest possible evidence is p = 0.05. Read a quiet result as "not enough signal," never as "proven nothing."'
    );
  });

  it("not significant, effect rounds to 0.0 (even) with coin-flip guesses", () => {
    const blocks = buildBlocks(activeFirst);
    const checkIns = buildCheckIns(blocks, {
      values: [5, 5, 5, 5, 5, 5],
      guesses: ["active", "active", "active", "active", "active", "active"],
    });
    const v = computeVerdict(makeInput(activeFirst, checkIns));

    expect(v.effect_estimate).toBe(0);
    expect(v.verdict_text).toBe(
      "Your Sleep quality could not tell Magnesium from a blank. Supplement and blank days ran about even."
    );
    // 21 of 42 correct: a coin flip.
    expect(v.guess_days_scored).toBe(42);
    expect(v.guess_days_correct).toBe(21);
    expect(v.blind_integrity_flag).toBe(false);
    expect(v.guess_text).toBe("Your guesses matched a coin flip: right on 21 of 42 days.");
  });

  it("not significant, small nonzero effect (well within luck)", () => {
    const blocks = buildBlocks(activeFirst);
    const checkIns = buildCheckIns(blocks, {
      values: [5, 6, 7, 4, 5, 6],
      guesses: ["unsure", "active", "placebo", "active", "unsure", "placebo"],
    });
    const v = computeVerdict(makeInput(activeFirst, checkIns));

    expect(v.effect_estimate).toBe(1);
    expect(v.permutation_p_value).toBeCloseTo(0.25, 10);
    expect(v.verdict_text).toBe(
      "Your Sleep quality could not tell Magnesium from a blank. Supplement days ran about 1 points higher, well within luck."
    );
  });

  it("lower_better flips the direction word to lower and is significant", () => {
    const blocks = buildBlocks(activeFirst);
    const checkIns = buildCheckIns(blocks, {
      values: [3, 3, 3, 8, 8, 8],
      guesses: ["active", "active", "active", "placebo", "placebo", "placebo"],
    });
    const v = computeVerdict(makeInput(activeFirst, checkIns, { metric_direction: "lower_better" }));

    expect(v.effect_estimate).toBe(-5);
    expect(v.permutation_p_value).toBeCloseTo(0.05, 10);
    expect(v.verdict_text).toBe(
      "Magnesium moved your Sleep quality. Supplement days ran about 5 points lower than blank days. Luck alone does that about 5% of the time."
    );
  });

  it("yes_no reports the effect and MDE in percentage points (x100)", () => {
    const blocks = buildBlocks(activeFirst);
    const checkIns = buildCheckIns(blocks, {
      values: [1, 1, 1, 0, 0, 0],
      guesses: ["active", "active", "active", "placebo", "placebo", "placebo"],
    });
    const v = computeVerdict(makeInput(activeFirst, checkIns, { metric_type: "yes_no" }));

    expect(v.effect_estimate).toBe(100);
    expect(v.effect_units).toBe("percentage points");
    expect(v.power_note).toContain("percentage points");
    // DEFAULT_WITHIN_SD.yes_no = 0.5 -> MDE ~ 38.4 pp for this design.
    expect(v.power_note).toContain("38.4 percentage points");
  });

  it("one condition entirely unlogged: null effect fields, honest text, guesses still score", () => {
    const blocks = buildBlocks(activeFirst);
    // Only the active blocks (0,1,2) are logged; every blank block is empty.
    const checkIns = buildCheckIns(blocks, {
      values: [7, 7, 7, 0, 0, 0],
      guesses: ["active", "active", "active", "placebo", "placebo", "placebo"],
      includeBlock: (i) => i < 3,
    });
    const v = computeVerdict(makeInput(activeFirst, checkIns));

    expect(v.effect_estimate).toBeNull();
    expect(v.permutation_p_value).toBeNull();
    expect(v.p_value_floor).toBeNull();
    expect(v.days_logged).toBe(21);
    expect(v.adherence_pct).toBe(50);
    expect(v.verdict_text).toBe(
      "Too few days were logged to test Magnesium against a blank. Log more days next run."
    );
    // Guesses still score over the logged days.
    expect(v.guess_days_scored).toBe(21);
    expect(v.guess_days_correct).toBe(21);
  });

  it("all-unsure guesses: no scored days, null accuracy, all-unsure text", () => {
    const blocks = buildBlocks(activeFirst);
    const checkIns = buildCheckIns(blocks, {
      values: [8, 8, 8, 2, 2, 2],
      guesses: ["unsure", "unsure", "unsure", "unsure", "unsure", "unsure"],
    });
    const v = computeVerdict(makeInput(activeFirst, checkIns));

    expect(v.guess_days_scored).toBe(0);
    expect(v.guess_days_unsure).toBe(42);
    expect(v.guess_accuracy).toBeNull();
    expect(v.guess_p_value_vs_chance).toBeNull();
    expect(v.blind_integrity_flag).toBe(false);
    expect(v.guess_text).toBe(
      "You marked every day unsure, so this run cannot score your guesses."
    );
  });

  it("a block with zero check-ins is excluded; p_value_floor reflects the included blocks", () => {
    const blocks = buildBlocks(activeFirst);
    // Drop one active block (index 2): 5 included blocks, 2 active.
    const checkIns = buildCheckIns(blocks, {
      values: [8, 8, 8, 2, 2, 2],
      guesses: ["active", "active", "active", "placebo", "placebo", "placebo"],
      includeBlock: (i) => i !== 2,
    });
    const v = computeVerdict(makeInput(activeFirst, checkIns));

    // C(5,2) = 10 -> floor 0.1.
    expect(v.p_value_floor).toBeCloseTo(0.1, 10);
    expect(v.days_logged).toBe(35);
    expect(v.adherence_pct).toBe(83.3);
  });

  it("is deterministic: identical input yields identical output", () => {
    const blocks = buildBlocks(activeFirst);
    const opts: CheckOpts = {
      values: [8, 7, 8, 3, 2, 3],
      guesses: ["active", "placebo", "unsure", "placebo", "active", "placebo"],
    };
    const a = computeVerdict(makeInput(activeFirst, buildCheckIns(blocks, opts)));
    const b = computeVerdict(makeInput(activeFirst, buildCheckIns(blocks, opts)));
    expect(a).toEqual(b);
  });
});

describe("round1", () => {
  it("rounds to one decimal", () => {
    expect(round1(83.333)).toBe(83.3);
    expect(round1(1.15)).toBe(1.2);
  });
});
