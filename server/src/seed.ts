import type { Db } from "./db/index.js";

// Idempotent demo seed. Runs only when SEED_DEMO=true. Provisions one demo
// account holding a single completed (unblinded) experiment with a full set of
// allocations, a realistic run of daily check-ins, and one static verdict. All
// numbers are hand-authored: no statistics are computed here.

export const DEMO_EMAIL = "demo@blind-keeper.app";

const VERDICT_TEXT =
  "Your sleep scores could not tell magnesium from a blank. You guessed the blank days about as often as a coin flip.";
const POWER_NOTE =
  'This run was small, so it can miss a weak effect. Read a null as "not enough signal," not "proven nothing."';

interface Block {
  index: number;
  code: string;
  condition: "active" | "placebo";
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

  const endDate = addDays(START, BLOCKS.length * BLOCK_LENGTH - 1);
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
      "rating_0_10",
      "higher_better",
      BLOCK_LENGTH,
      BLOCKS.length,
      3,
      "Skip the last day of each block before switching packets.",
      isoDate(START),
      isoDate(endDate),
    ]
  );
  const experimentId = expRows[0].id;

  for (const block of BLOCKS) {
    const blockStart = addDays(START, block.index * BLOCK_LENGTH);
    const blockEnd = addDays(blockStart, BLOCK_LENGTH - 1);
    await db.query(
      `INSERT INTO allocations
         (experiment_id, block_index, code, condition, block_start_date, block_end_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [experimentId, block.index, block.code, block.condition, isoDate(blockStart), isoDate(blockEnd)]
    );
  }

  // A realistic, near-null run: active and blank days score about the same.
  for (let i = 0; i < BLOCKS.length * BLOCK_LENGTH; i++) {
    const date = addDays(START, i);
    const value = 6 + ((i * 3) % 5) * 0.4; // 6.0 .. 7.6, no real active/blank gap
    const guess = GUESS_CYCLE[i % GUESS_CYCLE.length];
    await db.query(
      `INSERT INTO check_ins (experiment_id, check_date, metric_value, note, placebo_guess)
       VALUES ($1, $2, $3, $4, $5)`,
      [experimentId, isoDate(date), value.toFixed(1), null, guess]
    );
  }

  await db.query(
    `INSERT INTO verdicts
       (experiment_id, effect_estimate, effect_units, permutation_p_value,
        guess_accuracy, guess_p_value_vs_chance, adherence_pct,
        blind_integrity_flag, power_note, verdict_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [experimentId, 0.2, "points", 0.42, 0.52, 0.66, 95.2, false, POWER_NOTE, VERDICT_TEXT]
  );

  log.info("demo seed inserted");
  return true;
}
