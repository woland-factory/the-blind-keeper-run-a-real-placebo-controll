import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db/index.js";
import { METRIC_TYPES, METRIC_DIRECTIONS, METRIC_UNITS, DEFAULT_WITHIN_SD } from "./metrics.js";
import type { MetricType } from "./metrics.js";
import { minimumDetectableEffect, pValueFloor } from "./power.js";
import { blocklistMatch } from "./safety/blocklist.js";
import { getTemplate } from "./templates.js";

// Unambiguous code alphabet: no 0/O/1/I, so a handwritten packet label is never
// misread.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 3;

export const MIN_BLOCK_LENGTH = 3;
export const MAX_BLOCK_LENGTH = 14;
export const MIN_BLOCKS = 6;
export const MAX_BLOCKS = 12;

// A domain-rule rejection: a well-formed request the business rules refuse.
export class ExperimentError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Preview accepts a candidate design. substance_name is optional so the power
// statement updates before the user has typed a substance; the safety check
// simply reports "not blocked" until one is present.
export const previewSchema = z
  .object({
    substance_name: z.string().trim().max(80).optional(),
    metric_type: z.enum(METRIC_TYPES),
    block_length_days: z.number().int().min(MIN_BLOCK_LENGTH).max(MAX_BLOCK_LENGTH),
    num_blocks: z
      .number()
      .int()
      .min(MIN_BLOCKS)
      .max(MAX_BLOCKS)
      .refine((n) => n % 2 === 0, "even"),
    template_id: z.string().max(40).optional(),
  })
  .strict();

// The base shape for create. Ranges that need a specific plain message are
// checked after parsing (see validateCreate); .strict() rejects any extra field,
// which is how a client-supplied num_active_blocks is refused.
export const createSchema = z
  .object({
    substance_name: z.string().trim().min(1).max(80),
    metric_name: z.string().trim().min(1).max(60),
    metric_type: z.enum(METRIC_TYPES),
    metric_direction: z.enum(METRIC_DIRECTIONS),
    block_length_days: z.number().int(),
    num_blocks: z.number().int(),
    washout_note: z.string().trim().max(200).optional().default(""),
    acknowledged: z.boolean(),
  })
  .strict();

export type CreateInput = z.infer<typeof createSchema>;

function assumedWithinSd(metricType: MetricType, templateId?: string): number {
  if (templateId) {
    const t = getTemplate(templateId);
    if (t && t.metric_type === metricType) return t.assumed_within_sd;
  }
  return DEFAULT_WITHIN_SD[metricType];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface PreviewResult {
  num_active_blocks: number;
  num_blank_blocks: number;
  run_length_days: number;
  p_value_floor: number;
  mde: number;
  mde_units: string;
  can_reach_significance: boolean;
  safety: { blocked: boolean; matched_term: string | null };
}

export function previewDesign(input: z.infer<typeof previewSchema>): PreviewResult {
  const numActive = input.num_blocks / 2;
  const numBlank = input.num_blocks - numActive;
  const sd = assumedWithinSd(input.metric_type, input.template_id);
  const floor = pValueFloor(input.num_blocks, numActive);
  const mde = minimumDetectableEffect({
    assumedWithinSd: sd,
    blockLengthDays: input.block_length_days,
    numActive,
    numBlank,
  });
  const matched = input.substance_name ? blocklistMatch(input.substance_name) : null;
  return {
    num_active_blocks: numActive,
    num_blank_blocks: numBlank,
    run_length_days: input.block_length_days * input.num_blocks,
    p_value_floor: floor,
    mde: round1(mde),
    mde_units: METRIC_UNITS[input.metric_type],
    can_reach_significance: floor <= 0.05,
    safety: { blocked: matched !== null, matched_term: matched },
  };
}

/**
 * Apply the domain rules that carry a specific plain message. Structural and
 * enum validation already happened in createSchema; this covers the numeric
 * ranges, the acknowledgement, and the blocklist. Throws ExperimentError.
 */
export function validateCreate(input: CreateInput): void {
  if (input.block_length_days < MIN_BLOCK_LENGTH || input.block_length_days > MAX_BLOCK_LENGTH) {
    throw new ExperimentError(422, "invalid_input", "Use 3 to 14 days per block.");
  }
  if (input.num_blocks < MIN_BLOCKS || input.num_blocks > MAX_BLOCKS || input.num_blocks % 2 !== 0) {
    throw new ExperimentError(
      422,
      "invalid_input",
      "Use an even number of blocks, at least 6, so active and blank match."
    );
  }
  if (input.acknowledged !== true) {
    throw new ExperimentError(
      422,
      "invalid_input",
      "Check the box to confirm this is a supplement or behavior, not a prescription drug."
    );
  }
  const matched = blocklistMatch(input.substance_name);
  if (matched) {
    throw new ExperimentError(
      422,
      "blocked",
      `${input.substance_name} looks like a prescription drug. This app is for supplements and behavior changes. Choose something else.`
    );
  }
}

/** Fisher-Yates shuffle using a CSPRNG. Never Math.random. */
function secureShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** One unique neutral code per block, drawn from the unambiguous alphabet. */
function generateUniqueCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateCode());
  }
  return [...codes];
}

// The non-secret summary shape returned by create and GET /:id.
export interface ExperimentSummary {
  id: string;
  status: string;
  pre_registered_at: string;
  substance_name: string;
  metric_name: string;
  metric_type: string;
  metric_direction: string;
  block_length_days: number;
  num_blocks: number;
  num_active_blocks: number;
  run_length_days: number;
  washout_note: string;
}

interface ExperimentRow {
  id: string;
  status: string;
  pre_registered_at: string;
  substance_name: string;
  metric_name: string;
  metric_type: string;
  metric_direction: string;
  block_length_days: number;
  num_blocks: number;
  num_active_blocks: number;
  washout_note: string;
}

function toSummary(row: ExperimentRow): ExperimentSummary {
  return {
    id: row.id,
    status: row.status,
    pre_registered_at: row.pre_registered_at,
    substance_name: row.substance_name,
    metric_name: row.metric_name,
    metric_type: row.metric_type,
    metric_direction: row.metric_direction,
    block_length_days: row.block_length_days,
    num_blocks: row.num_blocks,
    num_active_blocks: row.num_active_blocks,
    run_length_days: row.block_length_days * row.num_blocks,
    washout_note: row.washout_note,
  };
}

/**
 * Validate, lock, pre-register, and generate the secret allocation. The
 * allocation (code-to-condition, in fixed block order) is created here and never
 * returned. Absolute calendar dates stay NULL until confirm-ready (EPIC 3).
 */
export async function createExperiment(
  db: Db,
  userId: string,
  input: CreateInput
): Promise<ExperimentSummary> {
  validateCreate(input);

  const numActive = input.num_blocks / 2;
  const numBlank = input.num_blocks - numActive;

  const rows = await db.query<ExperimentRow>(
    `INSERT INTO experiments
       (user_id, substance_name, metric_name, metric_type, metric_direction,
        block_length_days, num_blocks, num_active_blocks, washout_note, status,
        pre_registered_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'prepped', now())
     RETURNING id, status, pre_registered_at, substance_name, metric_name,
               metric_type, metric_direction, block_length_days, num_blocks,
               num_active_blocks, washout_note`,
    [
      userId,
      input.substance_name,
      input.metric_name,
      input.metric_type,
      input.metric_direction,
      input.block_length_days,
      input.num_blocks,
      numActive,
      input.washout_note,
    ]
  );
  const experiment = rows[0];

  // Balanced condition vector, shuffled with a CSPRNG so the order is secret.
  const conditions = secureShuffle([
    ...Array<string>(numActive).fill("active"),
    ...Array<string>(numBlank).fill("placebo"),
  ]);
  const codes = generateUniqueCodes(input.num_blocks);

  for (let blockIndex = 0; blockIndex < input.num_blocks; blockIndex++) {
    await db.query(
      `INSERT INTO allocations (experiment_id, block_index, code, condition)
       VALUES ($1, $2, $3, $4)`,
      [experiment.id, blockIndex, codes[blockIndex], conditions[blockIndex]]
    );
  }

  return toSummary(experiment);
}

// Neutral tokens the user sees during prep. No condition word ever pairs with a
// code; the batch-to-contents link is stated once, on screen only.
const BATCH_1 = "Batch 1";
const BATCH_2 = "Batch 2";
const BLANK = "Blank";

export interface PrepPacket {
  code: string;
  batch: string;
  count: number;
}

export interface PrepBatch {
  label: string;
  contents: string;
}

// The blind-safe prep read model. Carries codes and a neutral batch token, plus
// the one-time batch-to-contents link. It NEVER carries a condition word, a
// block_index, or any date, so the code-to-day schedule stays sealed.
export interface PrepView {
  id: string;
  status: string;
  substance_name: string;
  block_length_days: number;
  num_blocks: number;
  capsules_per_code: number;
  batches: PrepBatch[];
  packets: PrepPacket[];
}

interface AllocationRow {
  block_index: number;
  code: string;
  condition: string;
}

/**
 * Owner-scoped, deterministic, blind-safe prep read model. A miss returns null
 * so the route answers 404 without leaking existence. The derivation uses no
 * read-time randomness, so the display is stable across reloads:
 *  - Batch 1 is every code whose condition equals block 0's condition. Because
 *    the condition vector was CSPRNG-shuffled at lock, block 0 is active about
 *    half the time, so which batch holds the substance is already randomized.
 *  - Fill order sorts each batch by its code string and interleaves the two, so
 *    the order is uncorrelated with the sealed block_index schedule.
 */
export async function getPrep(db: Db, userId: string, id: string): Promise<PrepView | null> {
  const expRows = await db.query<{
    id: string;
    status: string;
    substance_name: string;
    block_length_days: number;
    num_blocks: number;
  }>(
    `SELECT id, status, substance_name, block_length_days, num_blocks
       FROM experiments
      WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (expRows.length === 0) return null;
  const exp = expRows[0];

  const allocations = await db.query<AllocationRow>(
    `SELECT block_index, code, condition
       FROM allocations
      WHERE experiment_id = $1
      ORDER BY block_index`,
    [id]
  );

  const block0 = allocations.find((a) => a.block_index === 0);
  const c0 = block0 ? block0.condition : "active";

  const batch1Codes = allocations
    .filter((a) => a.condition === c0)
    .map((a) => a.code)
    .sort();
  const batch2Codes = allocations
    .filter((a) => a.condition !== c0)
    .map((a) => a.code)
    .sort();

  const count = exp.block_length_days;
  const packets: PrepPacket[] = [];
  const maxLen = Math.max(batch1Codes.length, batch2Codes.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < batch1Codes.length) packets.push({ code: batch1Codes[i], batch: BATCH_1, count });
    if (i < batch2Codes.length) packets.push({ code: batch2Codes[i], batch: BATCH_2, count });
  }

  const batch1Contents = c0 === "active" ? exp.substance_name : BLANK;
  const batch2Contents = c0 === "active" ? BLANK : exp.substance_name;

  return {
    id: exp.id,
    status: exp.status,
    substance_name: exp.substance_name,
    block_length_days: exp.block_length_days,
    num_blocks: exp.num_blocks,
    capsules_per_code: count,
    batches: [
      { label: BATCH_1, contents: batch1Contents },
      { label: BATCH_2, contents: batch2Contents },
    ],
    packets,
  };
}

/**
 * Confirm-ready: transition a prepped experiment to running, anchoring the
 * sealed schedule to a real calendar. A miss returns null (route -> 404); an
 * experiment in a state that cannot start throws ExperimentError (route -> 422).
 * Idempotent: a second call on a running experiment changes nothing.
 *
 * Dates are set before the status flip so a mid-way crash never leaves a running
 * experiment with unset block dates. The final flip is guarded by
 * status = 'prepped', so a retry is a no-op and it touches only the three
 * columns the immutability trigger permits.
 */
export async function confirmPrep(
  db: Db,
  userId: string,
  id: string
): Promise<(ExperimentSummary & { start_date: string | null; planned_end_date: string | null; created_at: string }) | null> {
  const rows = await db.query<{ status: string; block_length_days: number; num_blocks: number }>(
    `SELECT status, block_length_days, num_blocks
       FROM experiments
      WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (rows.length === 0) return null;
  const { status, block_length_days: length, num_blocks: numBlocks } = rows[0];

  if (status === "running") {
    // Idempotent success: return the current summary without moving a date.
    return getExperimentSummary(db, userId, id);
  }
  if (status !== "prepped") {
    const message =
      status === "unblinded" || status === "voided"
        ? "This run has already finished."
        : "This run cannot start from here.";
    throw new ExperimentError(422, "invalid_state", message);
  }

  // One anchor for every derived date. CURRENT_DATE is timezone-free and matches
  // the date columns, keeping the run deterministic.
  const anchor = await db.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  const today = anchor[0].today;

  // Contiguous blocks: block i runs [today + i*L, today + i*L + L - 1].
  await db.query(
    `UPDATE allocations
        SET block_start_date = $1::date + (block_index * $2::int),
            block_end_date   = $1::date + (block_index * $2::int) + ($2::int - 1)
      WHERE experiment_id = $3`,
    [today, length, id]
  );

  // Flip last, guarded by the current status. Touches only status, start_date,
  // and planned_end_date, so the immutability trigger never fires.
  await db.query(
    `UPDATE experiments
        SET status = 'running',
            start_date = $1::date,
            planned_end_date = $1::date + $2::int
      WHERE id = $3 AND status = 'prepped'`,
    [today, length * numBlocks - 1, id]
  );

  return getExperimentSummary(db, userId, id);
}

// The phase drives the whole dashboard. It is derived from status and today's
// date, never stored, so it stays consistent with the sealed calendar.
export type RunPhase = "prepped" | "running" | "complete" | "voided" | "unblinded";

// The blind-safe "today" read model. It carries today's single code and the
// non-secret progress numbers, and NEVER a condition, another block's code, a
// block_index, or a block date. Proven blind-safe by test.
export interface TodayView {
  id: string;
  status: string;
  phase: RunPhase;
  metric_name: string;
  metric_type: string;
  metric_direction: string;
  run_length_days: number;
  day_number: number | null;
  sealed_day_streak: number;
  days_remaining: number;
  today_code: string | null;
  check_in_done: boolean;
}

interface TodayRow {
  id: string;
  status: string;
  metric_name: string;
  metric_type: string;
  metric_direction: string;
  block_length_days: number;
  num_blocks: number;
  start_date: string | null;
  planned_end_date: string | null;
  days_since_start: number | null;
  days_to_end: number | null;
}

/**
 * Owner-scoped, blind-safe "today" read model. A miss returns null so the route
 * answers 404 without leaking existence. Every derived number comes off a single
 * CURRENT_DATE anchor. today_code is fetched separately (code only, never the
 * condition) and is non-null ONLY while running, so a sealed schedule never leaks.
 */
export async function getToday(db: Db, userId: string, id: string): Promise<TodayView | null> {
  const rows = await db.query<TodayRow>(
    `SELECT id, status, metric_name, metric_type, metric_direction,
            block_length_days, num_blocks,
            start_date::text AS start_date,
            planned_end_date::text AS planned_end_date,
            (CURRENT_DATE - start_date) AS days_since_start,
            (planned_end_date - CURRENT_DATE) AS days_to_end
       FROM experiments
      WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];

  const runLength = row.block_length_days * row.num_blocks;
  const sinceStart = row.days_since_start;
  const toEnd = row.days_to_end;

  let phase: RunPhase;
  if (row.status === "voided") {
    phase = "voided";
  } else if (row.status === "unblinded") {
    phase = "unblinded";
  } else if (row.status === "running") {
    // Within the calendar window is running; past the last block is complete.
    phase = toEnd !== null && toEnd >= 0 ? "running" : "complete";
  } else {
    phase = "prepped";
  }

  let todayCode: string | null = null;
  if (phase === "running") {
    // Code only. Never condition, never block_index. The BETWEEN uses the same
    // CURRENT_DATE anchor as the numbers above.
    const codeRows = await db.query<{ code: string }>(
      `SELECT code FROM allocations
        WHERE experiment_id = $1
          AND CURRENT_DATE BETWEEN block_start_date AND block_end_date`,
      [id]
    );
    todayCode = codeRows.length > 0 ? codeRows[0].code : null;
  }

  const doneRows = await db.query<{ done: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM check_ins WHERE experiment_id = $1 AND check_date = CURRENT_DATE
     ) AS done`,
    [id]
  );

  const dayNumber = phase === "running" && sinceStart !== null ? sinceStart + 1 : null;
  let sealedStreak = 0;
  if (phase === "running" && sinceStart !== null) {
    sealedStreak = Math.min(sinceStart + 1, runLength);
  } else if (phase === "complete") {
    sealedStreak = runLength;
  }
  const daysRemaining = phase === "running" && toEnd !== null ? Math.max(toEnd, 0) : 0;

  return {
    id: row.id,
    status: row.status,
    phase,
    metric_name: row.metric_name,
    metric_type: row.metric_type,
    metric_direction: row.metric_direction,
    run_length_days: runLength,
    day_number: dayNumber,
    sealed_day_streak: sealedStreak,
    days_remaining: daysRemaining,
    today_code: todayCode,
    check_in_done: doneRows[0].done,
  };
}

// The daily check-in, validated at the boundary. .strict() rejects any extra
// field, including a client-supplied check_date: the date is always the server's
// CURRENT_DATE. The placebo guess is user data, never the allocation.
export const checkInSchema = z
  .object({
    metric_value: z.number(),
    note: z.string().trim().max(500).optional().default(""),
    placebo_guess: z.enum(["placebo", "active", "unsure"]),
  })
  .strict();

export type CheckInInput = z.infer<typeof checkInSchema>;

/** Throw a 422 invalid_input with a plain message when the value is out of range. */
export function validateMetricValue(metricType: string, value: number): void {
  switch (metricType) {
    case "rating_0_10":
      if (!Number.isInteger(value) || value < 0 || value > 10) {
        throw new ExperimentError(422, "invalid_input", "Use a score from 0 to 10.");
      }
      return;
    case "minutes":
      if (value < 0 || value > 1440) {
        throw new ExperimentError(422, "invalid_input", "Use a number of minutes from 0 to 1440.");
      }
      return;
    case "count":
      if (!Number.isInteger(value) || value < 0 || value > 10000) {
        throw new ExperimentError(422, "invalid_input", "Use a whole number from 0 to 10000.");
      }
      return;
    case "yes_no":
      if (value !== 0 && value !== 1) {
        throw new ExperimentError(422, "invalid_input", "Choose yes or no.");
      }
      return;
    default:
      throw new ExperimentError(422, "invalid_input", "Check your entry and try again.");
  }
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === "23505") return true;
  const message = String((err as { message?: string })?.message ?? "");
  return /duplicate key|unique constraint/i.test(message);
}

/**
 * Record one check-in for today. Owner-scoped. A miss returns null (route -> 404).
 * State and metric guards throw ExperimentError. A second check-in the same day
 * hits the UNIQUE (experiment_id, check_date) guard and throws 409; the first row
 * is never edited. On success returns the refreshed blind-safe today payload.
 */
export async function submitCheckIn(
  db: Db,
  userId: string,
  id: string,
  input: CheckInInput
): Promise<TodayView | null> {
  const rows = await db.query<{
    status: string;
    metric_type: string;
    days_since_start: number | null;
    days_to_end: number | null;
  }>(
    `SELECT status, metric_type,
            (CURRENT_DATE - start_date) AS days_since_start,
            (planned_end_date - CURRENT_DATE) AS days_to_end
       FROM experiments
      WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (rows.length === 0) return null;
  const { status, metric_type, days_since_start: sinceStart, days_to_end: toEnd } = rows[0];

  if (status !== "running") {
    const message =
      status === "unblinded" || status === "voided"
        ? "This run has already finished."
        : "This run has not started.";
    throw new ExperimentError(422, "invalid_state", message);
  }
  // Running but past the last block: nothing to log today.
  if (toEnd === null || toEnd < 0 || sinceStart === null || sinceStart < 0) {
    throw new ExperimentError(422, "invalid_state", "This run is finished. Nothing to log today.");
  }

  validateMetricValue(metric_type, input.metric_value);

  const note = input.note.trim() === "" ? null : input.note.trim();
  try {
    await db.query(
      `INSERT INTO check_ins (experiment_id, check_date, metric_value, note, placebo_guess)
       VALUES ($1, CURRENT_DATE, $2, $3, $4)`,
      [id, input.metric_value, note, input.placebo_guess]
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ExperimentError(409, "already_checked_in", "You already checked in today.");
    }
    throw err;
  }

  return getToday(db, userId, id);
}

// The one intentional allocation reveal, gated behind voiding the run.
export interface RevealBlock {
  code: string;
  contents: string;
  block_start_date: string;
  block_end_date: string;
}

export interface BreakBlindReveal {
  id: string;
  status: string;
  broke_blind_at: string | null;
  substance_name: string;
  blocks: RevealBlock[];
}

async function buildReveal(db: Db, id: string): Promise<BreakBlindReveal> {
  const expRows = await db.query<{
    id: string;
    status: string;
    substance_name: string;
    broke_blind_at: string | null;
  }>(
    `SELECT id, status, substance_name, broke_blind_at
       FROM experiments WHERE id = $1`,
    [id]
  );
  const exp = expRows[0];
  const allocations = await db.query<{
    code: string;
    condition: string;
    block_start_date: string;
    block_end_date: string;
  }>(
    `SELECT code, condition,
            block_start_date::text AS block_start_date,
            block_end_date::text AS block_end_date
       FROM allocations
      WHERE experiment_id = $1
      ORDER BY block_index`,
    [id]
  );
  return {
    id: exp.id,
    status: exp.status,
    broke_blind_at: exp.broke_blind_at,
    substance_name: exp.substance_name,
    blocks: allocations.map((a) => ({
      code: a.code,
      contents: a.condition === "active" ? exp.substance_name : BLANK,
      block_start_date: a.block_start_date,
      block_end_date: a.block_end_date,
    })),
  };
}

/**
 * Break the blind: reveal the schedule and void the run permanently. Owner-scoped.
 * A miss returns null (route -> 404). Voiding touches only status and
 * broke_blind_at, so the immutability trigger never fires. Idempotent on an
 * already-voided run; refuses a finished (unblinded) or not-yet-started run.
 */
export async function breakBlind(
  db: Db,
  userId: string,
  id: string
): Promise<BreakBlindReveal | null> {
  const rows = await db.query<{ status: string }>(
    `SELECT status FROM experiments WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (rows.length === 0) return null;
  const status = rows[0].status;

  if (status === "running") {
    // Guarded by status = 'running' so a retry is a no-op and it touches only the
    // two columns the immutability trigger permits.
    await db.query(
      `UPDATE experiments
          SET status = 'voided', broke_blind_at = now()
        WHERE id = $1 AND status = 'running'`,
      [id]
    );
    return buildReveal(db, id);
  }
  if (status === "voided") {
    // Idempotent: the schedule is already unsealed. Re-show it, move nothing.
    return buildReveal(db, id);
  }
  const message = status === "unblinded" ? "This run has already finished." : "This run has not started.";
  throw new ExperimentError(422, "invalid_state", message);
}

/** Owner-only non-secret summary. A miss returns null (never leaks existence). */
export async function getExperimentSummary(
  db: Db,
  userId: string,
  id: string
): Promise<(ExperimentSummary & { start_date: string | null; planned_end_date: string | null; created_at: string }) | null> {
  const rows = await db.query<
    ExperimentRow & { start_date: string | null; planned_end_date: string | null; created_at: string }
  >(
    // Date columns are cast to text so they serialize as plain "YYYY-MM-DD",
    // not a midnight timestamp that would imply a time of day.
    `SELECT id, status, pre_registered_at, substance_name, metric_name,
            metric_type, metric_direction, block_length_days, num_blocks,
            num_active_blocks, washout_note,
            start_date::text AS start_date, planned_end_date::text AS planned_end_date,
            created_at
       FROM experiments
      WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ...toSummary(row),
    start_date: row.start_date,
    planned_end_date: row.planned_end_date,
    created_at: row.created_at,
  };
}
