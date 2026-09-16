import type { Db } from "./db/index.js";
import { computeVerdict } from "./verdict.js";
import type { Condition, PlaceboGuess } from "./verdict.js";

// Idempotent demo seed. Runs only when SEED_DEMO=true. Provisions one demo
// account holding a single completed (unblinded) experiment with a full set of
// allocations and a realistic run of daily check-ins. The verdict is computed
// by the real engine over that data, so the demo answer is a true output of the
// product, never hand-authored numbers.

export const DEMO_EMAIL = "demo@blind-keeper.app";

interface Block {
  index: number;
  code: string;
  condition: Condition;
}

const BLOCKS: Block[] = [
  { index: 0, code: "MQ7", condition: "placebo" },
  { index: 1, code: "ZK2", condition: "active" },
  { index: 2, code: "TX9", condition: "active" },
  { index: 3, code: "BW4", condition: "placebo" },
  { index: 4, code: "LN6", condition: "placebo" },
  { index: 5, code: "RP1", condition: "active" },
];

const BLOCK_LENGTH = 7;
const NUM_ACTIVE = 3;
const METRIC_TYPE = "rating_0_10";
const METRIC_DIRECTION = "higher_better";
const START = new Date("2026-07-01T00:00:00Z");

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const GUESS_CYCLE = ["placebo", "active", "unsure", "active", "placebo", "active", "unsure"];

// A realistic, near-null run: active and blank days score about the same.
function seededValue(i: number): number {
  return 6 + ((i * 3) % 5) * 0.4; // 6.0 .. 7.6, no real active/blank gap
}

export async function runSeed(db: Db, log: { info: (msg: string) => void } = console): Promise<boolean> {
  // Guard: only seed once. If the demo user already has an experiment, skip.
  const existing = await db.query<{ id: string }>(
    `SELECT e.id FROM users u JOIN experiments e ON e.user_id = u.id WHERE u.email = $1 LIMIT 1`,
    [DEMO_EMAIL]
  );
  if (existing.length > 0) {
    log.info("demo seed already present, skipping");
    return false;
  }

  const userRows = await db.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [DEMO_EMAIL]
  );
  const userId = userRows[0].id;

  const runLength = BLOCKS.length * BLOCK_LENGTH;
  const endDate = addDays(START, runLength - 1);
  const expRows = await db.query<{ id: string }>(
    `INSERT INTO experiments
       (user_id, substance_name, metric_name, metric_type, metric_direction,
        block_length_days, num_blocks, num_active_blocks, washout_note, status,
        pre_registered_at, start_date, planned_end_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unblinded', now(), $10, $11)
     RETURNING id`,
    [
      userId,
      "Magnesium glycinate",
      "Sleep quality",
      METRIC_TYPE,
      METRIC_DIRECTION,
      BLOCK_LENGTH,
      BLOCKS.length,
      NUM_ACTIVE,
      "Skip the last day of each block before switching packets.",
      isoDate(START),
      isoDate(endDate),
    ]
  );
  const experimentId = expRows[0].id;

  const allocations = BLOCKS.map((block) => {
    const blockStart = addDays(START, block.index * BLOCK_LENGTH);
    const blockEnd = addDays(blockStart, BLOCK_LENGTH - 1);
    return {
      condition: block.condition,
      block_start_date: isoDate(blockStart),
      block_end_date: isoDate(blockEnd),
      code: block.code,
      index: block.index,
    };
  });

  for (const a of allocations) {
    await db.query(
      `INSERT INTO allocations
         (experiment_id, block_index, code, condition, block_start_date, block_end_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [experimentId, a.index, a.code, a.condition, a.block_start_date, a.block_end_date]
    );
  }

  const checkIns = [];
  for (let i = 0; i < runLength; i++) {
    const date = isoDate(addDays(START, i));
    const value = seededValue(i);
    const guess = GUESS_CYCLE[i % GUESS_CYCLE.length] as PlaceboGuess;
    checkIns.push({ check_date: date, metric_value: value, placebo_guess: guess });
    await db.query(
      `INSERT INTO check_ins (experiment_id, check_date, metric_value, note, placebo_guess)
       VALUES ($1, $2, $3, $4, $5)`,
      [experimentId, date, value.toFixed(1), null, guess]
    );
  }

  // The verdict is a real engine output over the seeded data, not hand-authored.
  const v = computeVerdict({
    substance_name: "Magnesium glycinate",
    metric_name: "Sleep quality",
    metric_type: METRIC_TYPE,
    metric_direction: METRIC_DIRECTION,
    block_length_days: BLOCK_LENGTH,
    num_blocks: BLOCKS.length,
    num_active_blocks: NUM_ACTIVE,
    run_length_days: runLength,
    allocations: allocations.map((a) => ({
      condition: a.condition,
      block_start_date: a.block_start_date,
      block_end_date: a.block_end_date,
    })),
    check_ins: checkIns,
  });

  await db.query(
    `INSERT INTO verdicts
       (experiment_id, effect_estimate, effect_units, permutation_p_value,
        p_value_floor, guess_accuracy, guess_p_value_vs_chance, guess_days_scored,
        guess_days_correct, guess_days_unsure, days_logged, adherence_pct,
        blind_integrity_flag, power_note, verdict_text, guess_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      experimentId,
      v.effect_estimate,
      v.effect_units,
      v.permutation_p_value,
      v.p_value_floor,
      v.guess_accuracy,
      v.guess_p_value_vs_chance,
      v.guess_days_scored,
      v.guess_days_correct,
      v.guess_days_unsure,
      v.days_logged,
      v.adherence_pct,
      v.blind_integrity_flag,
      v.power_note,
      v.verdict_text,
      v.guess_text,
    ]
  );

  log.info("demo seed inserted");
  return true;
}
