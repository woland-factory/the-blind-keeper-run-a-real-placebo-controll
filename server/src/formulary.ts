// The personal formulary and its export: two owner-scoped read models over the
// existing tables. Both serialize ONLY finished runs (unblinded + voided), so a
// sealed run's allocation never crosses the wire. Every verdict number repeats
// the stored engine output unchanged; nothing here recomputes or re-judges.

import type { Db } from "./db/index.js";

const BLANK = "Blank";

// A hot read: a real user has a handful of lifetime runs. The cap keeps the
// query bounded and is covered by experiments_user_id_idx. No new index.
export const FORMULARY_LIMIT = 100;
// A safety bound on the export so the endpoint cannot grow without limit.
export const EXPORT_LIMIT = 1000;

export const FORMULARY_EXPORT_PATH = "/api/formulary/export";

export interface FormularyCardVerdict {
  effect_estimate: number | null;
  effect_units: string | null;
  permutation_p_value: number | null;
  significant: boolean;
  guess_days_correct: number;
  guess_days_scored: number;
  guesses_beat_chance: boolean;
  adherence_pct: number | null;
}

export interface FormularyCard {
  id: string;
  status: string;
  substance_name: string;
  metric_name: string;
  metric_type: string;
  run_length_days: number;
  ended_on: string | null;
  verdict: FormularyCardVerdict | null;
}

// Numeric columns come back from the driver as strings; coerce to real numbers,
// keeping null as null (mirrors the num() helper in experiments.ts).
function num(v: string | number | null): number | null {
  return v === null ? null : Number(v);
}

interface CardRow {
  id: string;
  status: string;
  substance_name: string;
  metric_name: string;
  metric_type: string;
  block_length_days: number;
  num_blocks: number;
  planned_end_date: string | null;
  broke_blind_at: string | null;
  effect_estimate: string | null;
  effect_units: string | null;
  permutation_p_value: string | null;
  guess_p_value_vs_chance: string | null;
  guess_days_correct: number | null;
  guess_days_scored: number | null;
  adherence_pct: string | null;
}

// The date the run finished: the planned end for an unblinded run, the date part
// of the break-blind timestamp for a voided one. Served as "YYYY-MM-DD".
function endedOn(row: CardRow): string | null {
  if (row.status === "voided") {
    return row.broke_blind_at ? row.broke_blind_at.slice(0, 10) : null;
  }
  return row.planned_end_date;
}

function rowToCardVerdict(row: CardRow): FormularyCardVerdict | null {
  // A voided run has no verdict row; a left join leaves every verdict column
  // null. Defensively treat a missing effect the same way.
  if (row.status !== "unblinded" || row.effect_estimate === null) return null;
  const permutation = num(row.permutation_p_value);
  const guessP = num(row.guess_p_value_vs_chance);
  return {
    effect_estimate: num(row.effect_estimate),
    effect_units: row.effect_units,
    permutation_p_value: permutation,
    // Identical rule to rowToVerdictNumbers: the card repeats, never re-judges.
    significant: permutation !== null && permutation <= 0.05,
    guess_days_correct: row.guess_days_correct ?? 0,
    guess_days_scored: row.guess_days_scored ?? 0,
    guesses_beat_chance: guessP !== null && guessP <= 0.05,
    adherence_pct: num(row.adherence_pct),
  };
}

/**
 * The requesting user's finished runs as cards, newest first, capped. Every
 * query is owner-scoped; only unblinded and voided runs are ever returned, so a
 * sealed run's schedule never appears. A left join keeps a voided run (which has
 * no verdict) in the list.
 */
export async function listFormulary(db: Db, userId: string): Promise<FormularyCard[]> {
  const rows = await db.query<CardRow>(
    `SELECT e.id, e.status, e.substance_name, e.metric_name, e.metric_type,
            e.block_length_days, e.num_blocks,
            e.planned_end_date::text AS planned_end_date,
            e.broke_blind_at::text   AS broke_blind_at,
            v.effect_estimate, v.effect_units, v.permutation_p_value,
            v.guess_p_value_vs_chance, v.guess_days_correct, v.guess_days_scored,
            v.adherence_pct
       FROM experiments e
       LEFT JOIN verdicts v ON v.experiment_id = e.id
      WHERE e.user_id = $1
        AND e.status IN ('unblinded', 'voided')
      ORDER BY COALESCE(v.computed_at, e.broke_blind_at, e.created_at) DESC
      LIMIT $2`,
    [userId, FORMULARY_LIMIT]
  );

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    substance_name: row.substance_name,
    metric_name: row.metric_name,
    metric_type: row.metric_type,
    run_length_days: row.block_length_days * row.num_blocks,
    ended_on: endedOn(row),
    verdict: rowToCardVerdict(row),
  }));
}

export interface ExportVerdict {
  effect_estimate: number | null;
  effect_units: string | null;
  permutation_p_value: number | null;
  p_value_floor: number | null;
  guess_accuracy: number | null;
  guess_p_value_vs_chance: number | null;
  guess_days_scored: number;
  guess_days_correct: number;
  guess_days_unsure: number;
  days_logged: number;
  adherence_pct: number | null;
  blind_integrity_flag: boolean;
  power_note: string;
  verdict_text: string;
  guess_text: string;
  computed_at: string;
}

export interface ExportScheduleBlock {
  code: string;
  condition: string;
  contents: string;
  block_start_date: string | null;
  block_end_date: string | null;
}

export interface ExportCheckIn {
  check_date: string;
  metric_value: number | null;
  note: string | null;
  placebo_guess: string | null;
}

export interface ExportRun {
  id: string;
  status: string;
  substance_name: string;
  metric_name: string;
  metric_type: string;
  metric_direction: string;
  block_length_days: number;
  num_blocks: number;
  num_active_blocks: number;
  run_length_days: number;
  washout_note: string;
  pre_registered_at: string;
  start_date: string | null;
  planned_end_date: string | null;
  broke_blind_at: string | null;
  verdict: ExportVerdict | null;
  schedule: ExportScheduleBlock[];
  check_ins: ExportCheckIn[];
}

export interface Export {
  schema_version: number;
  exported_for: string;
  runs: ExportRun[];
}

interface ExportExperimentRow {
  id: string;
  status: string;
  substance_name: string;
  metric_name: string;
  metric_type: string;
  metric_direction: string;
  block_length_days: number;
  num_blocks: number;
  num_active_blocks: number;
  washout_note: string;
  pre_registered_at: string;
  start_date: string | null;
  planned_end_date: string | null;
  broke_blind_at: string | null;
}

interface ExportVerdictRow {
  experiment_id: string;
  effect_estimate: string | null;
  effect_units: string | null;
  permutation_p_value: string | null;
  p_value_floor: string | null;
  guess_accuracy: string | null;
  guess_p_value_vs_chance: string | null;
  guess_days_scored: number | null;
  guess_days_correct: number | null;
  guess_days_unsure: number | null;
  days_logged: number | null;
  adherence_pct: string | null;
  blind_integrity_flag: boolean | null;
  power_note: string;
  verdict_text: string;
  guess_text: string;
  computed_at: string;
}

interface ExportAllocationRow {
  experiment_id: string;
  block_index: number;
  code: string;
  condition: string;
  block_start_date: string | null;
  block_end_date: string | null;
}

interface ExportCheckInRow {
  experiment_id: string;
  check_date: string;
  metric_value: string | null;
  note: string | null;
  placebo_guess: string | null;
}

/**
 * The requesting user's finished runs in full: design fields, the stored
 * verdict, the now-unsealed schedule, and the daily check-ins. Owner-scoped and
 * finished-only, so a sealed run and its allocation never appear. The child
 * queries are scoped to the run ids already fetched for this user, so no other
 * user's rows can reach the response.
 */
export async function buildExport(db: Db, userId: string, email: string): Promise<Export> {
  const experiments = await db.query<ExportExperimentRow>(
    `SELECT e.id, e.status, e.substance_name, e.metric_name, e.metric_type,
            e.metric_direction, e.block_length_days, e.num_blocks,
            e.num_active_blocks, e.washout_note, e.pre_registered_at,
            e.start_date::text AS start_date,
            e.planned_end_date::text AS planned_end_date,
            e.broke_blind_at
       FROM experiments e
       LEFT JOIN verdicts v ON v.experiment_id = e.id
      WHERE e.user_id = $1
        AND e.status IN ('unblinded', 'voided')
      ORDER BY COALESCE(v.computed_at, e.broke_blind_at, e.created_at) DESC
      LIMIT $2`,
    [userId, EXPORT_LIMIT]
  );

  if (experiments.length === 0) {
    return { schema_version: 1, exported_for: email, runs: [] };
  }

  const bySubstance = new Map(experiments.map((e) => [e.id, e.substance_name] as const));

  // The child reads are scoped through experiments by user_id and finished
  // status, so no other user's rows (and no sealed run's allocation) can reach
  // the response. The maps below only pick up ids present in `experiments`.
  const verdictRows = await db.query<ExportVerdictRow>(
    `SELECT v.experiment_id, v.effect_estimate, v.effect_units, v.permutation_p_value,
            v.p_value_floor, v.guess_accuracy, v.guess_p_value_vs_chance,
            v.guess_days_scored, v.guess_days_correct, v.guess_days_unsure, v.days_logged,
            v.adherence_pct, v.blind_integrity_flag, v.power_note, v.verdict_text,
            v.guess_text, v.computed_at
       FROM verdicts v
       JOIN experiments e ON e.id = v.experiment_id
      WHERE e.user_id = $1 AND e.status IN ('unblinded', 'voided')`,
    [userId]
  );
  const verdictByExp = new Map(verdictRows.map((v) => [v.experiment_id, v] as const));

  const allocationRows = await db.query<ExportAllocationRow>(
    `SELECT a.experiment_id, a.block_index, a.code, a.condition,
            a.block_start_date::text AS block_start_date,
            a.block_end_date::text AS block_end_date
       FROM allocations a
       JOIN experiments e ON e.id = a.experiment_id
      WHERE e.user_id = $1 AND e.status IN ('unblinded', 'voided')
      ORDER BY a.experiment_id, a.block_index`,
    [userId]
  );

  const checkInRows = await db.query<ExportCheckInRow>(
    `SELECT c.experiment_id, c.check_date::text AS check_date, c.metric_value, c.note, c.placebo_guess
       FROM check_ins c
       JOIN experiments e ON e.id = c.experiment_id
      WHERE e.user_id = $1 AND e.status IN ('unblinded', 'voided')
      ORDER BY c.experiment_id, c.check_date`,
    [userId]
  );

  const scheduleByExp = new Map<string, ExportScheduleBlock[]>();
  for (const a of allocationRows) {
    const contents = a.condition === "active" ? bySubstance.get(a.experiment_id) ?? "" : BLANK;
    const list = scheduleByExp.get(a.experiment_id) ?? [];
    list.push({
      code: a.code,
      condition: a.condition,
      contents,
      block_start_date: a.block_start_date,
      block_end_date: a.block_end_date,
    });
    scheduleByExp.set(a.experiment_id, list);
  }

  const checkInsByExp = new Map<string, ExportCheckIn[]>();
  for (const c of checkInRows) {
    const list = checkInsByExp.get(c.experiment_id) ?? [];
    list.push({
      check_date: c.check_date,
      metric_value: num(c.metric_value),
      note: c.note,
      placebo_guess: c.placebo_guess,
    });
    checkInsByExp.set(c.experiment_id, list);
  }

  const runs: ExportRun[] = experiments.map((e) => {
    const v = verdictByExp.get(e.id) ?? null;
    return {
      id: e.id,
      status: e.status,
      substance_name: e.substance_name,
      metric_name: e.metric_name,
      metric_type: e.metric_type,
      metric_direction: e.metric_direction,
      block_length_days: e.block_length_days,
      num_blocks: e.num_blocks,
      num_active_blocks: e.num_active_blocks,
      run_length_days: e.block_length_days * e.num_blocks,
      washout_note: e.washout_note,
      pre_registered_at: e.pre_registered_at,
      start_date: e.start_date,
      planned_end_date: e.planned_end_date,
      broke_blind_at: e.broke_blind_at,
      verdict: v
        ? {
            effect_estimate: num(v.effect_estimate),
            effect_units: v.effect_units,
            permutation_p_value: num(v.permutation_p_value),
            p_value_floor: num(v.p_value_floor),
            guess_accuracy: num(v.guess_accuracy),
            guess_p_value_vs_chance: num(v.guess_p_value_vs_chance),
            guess_days_scored: v.guess_days_scored ?? 0,
            guess_days_correct: v.guess_days_correct ?? 0,
            guess_days_unsure: v.guess_days_unsure ?? 0,
            days_logged: v.days_logged ?? 0,
            adherence_pct: num(v.adherence_pct),
            blind_integrity_flag: v.blind_integrity_flag ?? false,
            power_note: v.power_note,
            verdict_text: v.verdict_text,
            guess_text: v.guess_text,
            computed_at: v.computed_at,
          }
        : null,
      schedule: scheduleByExp.get(e.id) ?? [],
      check_ins: checkInsByExp.get(e.id) ?? [],
    };
  });

  return { schema_version: 1, exported_for: email, runs };
}
