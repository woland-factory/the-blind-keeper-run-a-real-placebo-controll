import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { loadEnv } from "../src/env.js";
import { DEMO_EMAIL, runSeed } from "../src/seed.js";
import { computeVerdict, type Condition, type PlaceboGuess } from "../src/verdict.js";
import type { MetricDirection, MetricType } from "../src/metrics.js";

const silent = { info: () => {} };

describe("SEED_DEMO", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createDb({ driver: "pglite" });
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("is off by default in the environment", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DB_DRIVER: "pglite",
      SESSION_COOKIE_SECRET: "test-secret-that-is-long-enough-to-pass-min",
    });
    expect(env.SEED_DEMO).toBe(false);
  });

  it("provisions a demo user with one unblinded experiment and a verdict", async () => {
    const inserted = await runSeed(db, silent);
    expect(inserted).toBe(true);

    const users = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [DEMO_EMAIL]);
    expect(users).toHaveLength(1);

    const exps = await db.query<{ status: string }>(
      `SELECT status FROM experiments WHERE user_id = $1`,
      [users[0].id]
    );
    expect(exps).toHaveLength(1);
    expect(exps[0].status).toBe("unblinded");

    const verdicts = await db.query(
      `SELECT verdict_text FROM verdicts v
         JOIN experiments e ON e.id = v.experiment_id
        WHERE e.user_id = $1`,
      [users[0].id]
    );
    expect(verdicts).toHaveLength(1);

    const allocations = await db.query(
      `SELECT a.id FROM allocations a
         JOIN experiments e ON e.id = a.experiment_id
        WHERE e.user_id = $1`,
      [users[0].id]
    );
    expect(allocations.length).toBeGreaterThan(0);
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    const inserted = await runSeed(db, silent);
    expect(inserted).toBe(false);

    const exps = await db.query(`SELECT id FROM experiments`);
    expect(exps).toHaveLength(1);
  });

  it("stores a demo verdict that equals the engine output over the seeded data", async () => {
    const [exp] = await db.query<{
      id: string;
      substance_name: string;
      metric_name: string;
      metric_type: string;
      metric_direction: string;
      block_length_days: number;
      num_blocks: number;
      num_active_blocks: number;
    }>(
      `SELECT id, substance_name, metric_name, metric_type, metric_direction,
              block_length_days, num_blocks, num_active_blocks
         FROM experiments LIMIT 1`
    );

    const allocations = await db.query<{
      condition: string;
      block_start_date: string;
      block_end_date: string;
    }>(
      `SELECT condition, block_start_date::text AS block_start_date, block_end_date::text AS block_end_date
         FROM allocations WHERE experiment_id = $1 ORDER BY block_index`,
      [exp.id]
    );
    const checkIns = await db.query<{ check_date: string; metric_value: string; placebo_guess: string }>(
      `SELECT check_date::text AS check_date, metric_value, placebo_guess
         FROM check_ins WHERE experiment_id = $1`,
      [exp.id]
    );

    const recomputed = computeVerdict({
      substance_name: exp.substance_name,
      metric_name: exp.metric_name,
      metric_type: exp.metric_type as MetricType,
      metric_direction: exp.metric_direction as MetricDirection,
      block_length_days: exp.block_length_days,
      num_blocks: exp.num_blocks,
      num_active_blocks: exp.num_active_blocks,
      run_length_days: exp.block_length_days * exp.num_blocks,
      allocations: allocations.map((a) => ({
        condition: a.condition as Condition,
        block_start_date: a.block_start_date,
        block_end_date: a.block_end_date,
      })),
      check_ins: checkIns.map((c) => ({
        check_date: c.check_date,
        metric_value: Number(c.metric_value),
        placebo_guess: c.placebo_guess as PlaceboGuess,
      })),
    });

    const [stored] = await db.query<Record<string, string | number | boolean | null>>(
      `SELECT effect_estimate, effect_units, permutation_p_value, p_value_floor,
              guess_accuracy, guess_p_value_vs_chance, guess_days_scored,
              guess_days_correct, guess_days_unsure, days_logged, adherence_pct,
              blind_integrity_flag, power_note, verdict_text, guess_text
         FROM verdicts WHERE experiment_id = $1`,
      [exp.id]
    );

    // Numeric columns come back as strings; coerce before comparing.
    expect(Number(stored.effect_estimate)).toBeCloseTo(recomputed.effect_estimate!, 10);
    expect(stored.effect_units).toBe(recomputed.effect_units);
    expect(Number(stored.permutation_p_value)).toBeCloseTo(recomputed.permutation_p_value!, 10);
    expect(Number(stored.p_value_floor)).toBeCloseTo(recomputed.p_value_floor!, 10);
    expect(Number(stored.guess_accuracy)).toBeCloseTo(recomputed.guess_accuracy!, 10);
    expect(Number(stored.guess_p_value_vs_chance)).toBeCloseTo(recomputed.guess_p_value_vs_chance!, 10);
    expect(Number(stored.guess_days_scored)).toBe(recomputed.guess_days_scored);
    expect(Number(stored.guess_days_correct)).toBe(recomputed.guess_days_correct);
    expect(Number(stored.guess_days_unsure)).toBe(recomputed.guess_days_unsure);
    expect(Number(stored.days_logged)).toBe(recomputed.days_logged);
    expect(Number(stored.adherence_pct)).toBeCloseTo(recomputed.adherence_pct, 10);
    expect(stored.blind_integrity_flag).toBe(recomputed.blind_integrity_flag);
    expect(stored.power_note).toBe(recomputed.power_note);
    expect(stored.verdict_text).toBe(recomputed.verdict_text);
    expect(stored.guess_text).toBe(recomputed.guess_text);
  });
});
