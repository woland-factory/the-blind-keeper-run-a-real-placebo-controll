// Design-time power math. Pure functions, no I/O, no randomness. The block is
// the unit of randomization. The exact permutation test lives in EPIC 5; these
// are honest up-front estimates the user sees before committing.

// z_{0.05, one-sided} (1.6449) + z_{0.80} (0.8416).
const Z = 2.4865;

/**
 * Exact integer binomial coefficient, computed multiplicatively so it never
 * overflows through a factorial. Each partial product is itself a binomial
 * coefficient, so the running value stays integral.
 */
export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) {
    result = (result * (n - kk + i)) / i;
  }
  return Math.round(result);
}

/**
 * Smallest p-value the permutation test can ever produce for this block count.
 * The test permutes active/blank labels across blocks; there are C(n, k)
 * distinct labelings, so the single most-extreme one gives 1 / C(n, k).
 */
export function pValueFloor(numBlocks: number, numActive: number): number {
  const c = combinations(numBlocks, numActive);
  if (c === 0) return 1;
  return 1 / c;
}

/**
 * Normal-approximation estimate, in metric units, of the smallest true effect
 * this design could detect with ~80% power at a one-sided alpha = 0.05.
 */
export function minimumDetectableEffect(input: {
  assumedWithinSd: number;
  blockLengthDays: number;
  numActive: number;
  numBlank: number;
}): number {
  const seBlockMean = input.assumedWithinSd / Math.sqrt(input.blockLengthDays);
  const seDiff = seBlockMean * Math.sqrt(1 / input.numActive + 1 / input.numBlank);
  return Z * seDiff;
}

export const MIN_NOISE_DF = 4;

/**
 * Pooled within-block standard deviation across completed blocks: the user's
 * measured day-to-day noise for a metric. `blocks` is one array of daily metric
 * values per block that has data. Blocks with fewer than two values carry no
 * within-block deviation and are skipped. Returns null when the pooled residual
 * degrees of freedom fall below MIN_NOISE_DF or the spread is zero, so a flimsy
 * or degenerate history falls back to the stated assumption.
 */
export function pooledWithinSd(blocks: number[][]): number | null {
  let ss = 0;
  let df = 0;
  for (const values of blocks) {
    if (values.length < 2) continue;
    const m = values.reduce((s, v) => s + v, 0) / values.length;
    for (const v of values) ss += (v - m) ** 2;
    df += values.length - 1;
  }
  if (df < MIN_NOISE_DF || ss <= 0) return null;
  return Math.sqrt(ss / df);
}
