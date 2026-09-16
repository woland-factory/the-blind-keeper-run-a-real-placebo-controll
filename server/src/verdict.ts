// The verdict engine. Pure, deterministic arithmetic: the same stored data
// always yields the same verdict. No I/O, no env, no network, no RNG. This is
// the product's moment of truth, so the answer is computed, never generated.
//
// Only power.ts and metrics.ts may be imported here.

import { minimumDetectableEffect, pValueFloor } from "./power.js";
import { DEFAULT_WITHIN_SD, METRIC_UNITS } from "./metrics.js";
import type { MetricDirection, MetricType } from "./metrics.js";

export type Condition = "active" | "placebo";
export type PlaceboGuess = "active" | "placebo" | "unsure";

export interface VerdictAllocation {
  condition: Condition;
  block_start_date: string; // "YYYY-MM-DD"
  block_end_date: string; // "YYYY-MM-DD"
}

export interface VerdictCheckIn {
  check_date: string; // "YYYY-MM-DD"
  metric_value: number;
  placebo_guess: PlaceboGuess;
}

export interface VerdictInput {
  substance_name: string;
  metric_name: string;
  metric_type: MetricType;
  metric_direction: MetricDirection;
  block_length_days: number;
  num_blocks: number;
  num_active_blocks: number;
  run_length_days: number;
  allocations: VerdictAllocation[];
  check_ins: VerdictCheckIn[];
}

// Every column stored on the verdicts row. significant and guesses_beat_chance
// are derived from the p-values at serialization, so they are not stored.
export interface ComputedVerdict {
  effect_estimate: number | null;
  effect_units: string;
  permutation_p_value: number | null;
  p_value_floor: number | null;
  guess_accuracy: number | null;
  guess_p_value_vs_chance: number | null;
  guess_days_scored: number;
  guess_days_correct: number;
  guess_days_unsure: number;
  days_logged: number;
  adherence_pct: number;
  blind_integrity_flag: boolean;
  power_note: string;
  verdict_text: string;
  guess_text: string;
}

// ---- formatting helpers (unit-tested, verbatim per spec 2.5) ----

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The plain decimal of a p-value floor, e.g. 0.05. Trims to two significant
 *  figures so a 12-block floor prints as 0.0011 rather than a long tail. */
function formatFloor(p: number): string {
  return Number(p.toPrecision(2)).toString();
}

/** "about {pct} of the time" for p >= 0.001, else the small-number phrase. */
export function luckPhrase(p: number): string {
  if (p < 0.001) return "fewer than 1 time in 1000";
  const pct = p * 100;
  const shown = pct >= 1 ? `${Math.round(pct)}%` : `${round1(pct)}%`;
  return `about ${shown} of the time`;
}

// ---- the exact tests ----

/** Every way to choose `a` indices out of `m`, as arrays of indices. Iterative
 *  so it never recurses deeply; C(12,6)=924 is the worst case. */
function indexCombinations(m: number, a: number): number[][] {
  const result: number[][] = [];
  if (a < 0 || a > m) return result;
  const combo = Array.from({ length: a }, (_, i) => i);
  while (true) {
    result.push(combo.slice());
    // Advance the rightmost index that can still move.
    let i = a - 1;
    while (i >= 0 && combo[i] === m - a + i) i--;
    if (i < 0) break;
    combo[i]++;
    for (let j = i + 1; j < a; j++) combo[j] = combo[j - 1] + 1;
  }
  return result;
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export interface PermutationResult {
  p_value: number;
  floor: number;
}

/**
 * Exact one-sided permutation test on block means. `blockMeans` are the means of
 * the INCLUDED blocks, `activeCount` how many of them are truly active. The test
 * statistic is (mean of active-labeled blocks) minus (mean of blank-labeled
 * blocks), negated for lower_better so positive always means "the supplement
 * helped". Enumerates all C(m, activeCount) labelings; ties count and the
 * observed labeling always counts, so p >= 1 / C(m, activeCount).
 */
export function permutationTest(
  blockMeans: number[],
  activeCount: number,
  direction: MetricDirection
): PermutationResult {
  const m = blockMeans.length;
  const sign = direction === "lower_better" ? -1 : 1;
  const total = blockMeans.reduce((s, v) => s + v, 0);
  const oriented = (activeIdx: number[]): number => {
    const activeSum = activeIdx.reduce((s, i) => s + blockMeans[i], 0);
    const activeMean = activeSum / activeCount;
    const blankMean = (total - activeSum) / (m - activeCount);
    return sign * (activeMean - blankMean);
  };
  // The observed labeling is the first `activeCount` blocks by construction of
  // the caller (active blocks are grouped), but the statistic only depends on
  // which means are active, so any observed active-index set works. We compute
  // the observed statistic from the true active indices passed by the caller.
  const observedIdx = Array.from({ length: activeCount }, (_, i) => i);
  const observedStat = oriented(observedIdx);
  const labelings = indexCombinations(m, activeCount);
  let atLeast = 0;
  for (const labeling of labelings) {
    if (oriented(labeling) >= observedStat - 1e-9) atLeast++;
  }
  return { p_value: atLeast / labelings.length, floor: 1 / labelings.length };
}

/**
 * Exact one-sided binomial test of k correct out of n scored guesses versus a
 * fair coin (chance 0.5): P(X >= k | n, 0.5) = sum_{i=k..n} C(n,i) / 2^n.
 * Computed via the term recurrence term(i+1) = term(i) * (n-i)/(i+1) starting
 * from term(0) = 0.5^n, so it never overflows a factorial. Null when n = 0.
 */
export function binomialTestVsChance(k: number, n: number): number | null {
  if (n === 0) return null;
  let term = Math.pow(0.5, n); // P(X = 0)
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += term;
    term = (term * (n - i)) / (i + 1);
  }
  return sum;
}

// ---- date windowing ----

function inRange(date: string, start: string, end: string): boolean {
  // ISO "YYYY-MM-DD" strings compare correctly lexicographically.
  return date >= start && date <= end;
}

// ---- the composed verdict ----

export function computeVerdict(input: VerdictInput): ComputedVerdict {
  const {
    substance_name,
    metric_name,
    metric_type,
    metric_direction,
    block_length_days,
    num_blocks,
    num_active_blocks,
    run_length_days,
    allocations,
    check_ins,
  } = input;

  const units = METRIC_UNITS[metric_type];

  // The run window is the calendar spanned by the sealed blocks. A stray row
  // outside it (possible after a dev date shift) is ignored everywhere below.
  const windowStart = allocations.reduce(
    (min, a) => (a.block_start_date < min ? a.block_start_date : min),
    allocations[0]?.block_start_date ?? ""
  );
  const windowEnd = allocations.reduce(
    (max, a) => (a.block_end_date > max ? a.block_end_date : max),
    allocations[0]?.block_end_date ?? ""
  );
  const windowed = check_ins.filter((c) => inRange(c.check_date, windowStart, windowEnd));

  // Adherence.
  const days_logged = windowed.length;
  const adherence_pct = round1((100 * days_logged) / run_length_days);

  // Block means over in-window check-ins. A block with no check-ins has no mean
  // and is excluded from the effect test.
  const blockMeans: number[] = [];
  const blockConditions: Condition[] = [];
  for (const alloc of allocations) {
    const values = windowed
      .filter((c) => inRange(c.check_date, alloc.block_start_date, alloc.block_end_date))
      .map((c) => c.metric_value);
    if (values.length > 0) {
      blockMeans.push(mean(values));
      blockConditions.push(alloc.condition);
    }
  }

  const activeMeans = blockMeans.filter((_, i) => blockConditions[i] === "active");
  const blankMeans = blockMeans.filter((_, i) => blockConditions[i] === "placebo");
  const yesNoScale = metric_type === "yes_no" ? 100 : 1;

  let effect_estimate: number | null = null;
  let permutation_p_value: number | null = null;
  let p_value_floor: number | null = null;
  let significant = false;

  if (activeMeans.length > 0 && blankMeans.length > 0) {
    const rawEffect = mean(activeMeans) - mean(blankMeans);
    effect_estimate = round1(rawEffect * yesNoScale);

    // Order the included blocks active-first so the observed labeling is the
    // leading index set; the statistic only depends on which means are active.
    const orderedMeans = [...activeMeans, ...blankMeans];
    const perm = permutationTest(orderedMeans, activeMeans.length, metric_direction);
    permutation_p_value = perm.p_value;
    p_value_floor = perm.floor;
    significant = permutation_p_value <= 0.05;
  }

  // Guess scoring: match each in-window check-in to its block, exclude unsure.
  let guess_days_scored = 0;
  let guess_days_correct = 0;
  let guess_days_unsure = 0;
  for (const c of windowed) {
    if (c.placebo_guess === "unsure") {
      guess_days_unsure++;
      continue;
    }
    const block = allocations.find((a) =>
      inRange(c.check_date, a.block_start_date, a.block_end_date)
    );
    if (!block) continue; // in the run window but not inside any block
    guess_days_scored++;
    if (c.placebo_guess === block.condition) guess_days_correct++;
  }
  const guess_accuracy =
    guess_days_scored === 0 ? null : round3(guess_days_correct / guess_days_scored);
  const guess_p_value_vs_chance = binomialTestVsChance(guess_days_correct, guess_days_scored);
  const guesses_beat_chance =
    guess_p_value_vs_chance !== null && guess_p_value_vs_chance <= 0.05;
  const blind_integrity_flag = guesses_beat_chance;

  // Power note over the DESIGNED blocks with the stated within-person noise.
  const numBlank = num_blocks - num_active_blocks;
  const mde = round1(
    minimumDetectableEffect({
      assumedWithinSd: DEFAULT_WITHIN_SD[metric_type],
      blockLengthDays: block_length_days,
      numActive: num_active_blocks,
      numBlank,
    }) * yesNoScale
  );
  const designFloor = pValueFloor(num_blocks, num_active_blocks);
  const power_note = `A run this size can reliably notice a change of about ${mde} ${units} or larger, given a typical amount of day-to-day noise. With ${num_blocks} blocks, the strongest possible evidence is p = ${formatFloor(designFloor)}. Read a quiet result as "not enough signal," never as "proven nothing."`;

  // Part one: the effect.
  let verdict_text: string;
  if (effect_estimate === null || permutation_p_value === null) {
    verdict_text = `Too few days were logged to test ${substance_name} against a blank. Log more days next run.`;
  } else {
    const magnitude = Math.abs(effect_estimate);
    const directionWord = effect_estimate > 0 ? "higher" : "lower";
    if (significant) {
      verdict_text = `${substance_name} moved your ${metric_name}. Supplement days ran about ${magnitude} ${units} ${directionWord} than blank days. Luck alone does that ${luckPhrase(permutation_p_value)}.`;
    } else if (magnitude === 0) {
      verdict_text = `Your ${metric_name} could not tell ${substance_name} from a blank. Supplement and blank days ran about even.`;
    } else {
      verdict_text = `Your ${metric_name} could not tell ${substance_name} from a blank. Supplement days ran about ${magnitude} ${units} ${directionWord}, well within luck.`;
    }
  }

  // Part two: could you feel it.
  let guess_text: string;
  if (guess_days_scored === 0) {
    guess_text = `You marked every day unsure, so this run cannot score your guesses.`;
  } else if (guesses_beat_chance) {
    guess_text = `You felt it. You guessed right on ${guess_days_correct} of ${guess_days_scored} days. A coin gets about half.`;
  } else {
    guess_text = `Your guesses matched a coin flip: right on ${guess_days_correct} of ${guess_days_scored} days.`;
  }

  return {
    effect_estimate,
    effect_units: units,
    permutation_p_value,
    p_value_floor,
    guess_accuracy,
    guess_p_value_vs_chance,
    guess_days_scored,
    guess_days_correct,
    guess_days_unsure,
    days_logged,
    adherence_pct,
    blind_integrity_flag,
    power_note,
    verdict_text,
    guess_text,
  };
}
