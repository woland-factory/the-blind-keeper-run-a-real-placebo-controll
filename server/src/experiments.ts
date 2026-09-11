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

/** Owner-only non-secret summary. A miss returns null (never leaks existence). */
export async function getExperimentSummary(
  db: Db,
  userId: string,
  id: string
): Promise<(ExperimentSummary & { start_date: string | null; planned_end_date: string | null; created_at: string }) | null> {
  const rows = await db.query<
    ExperimentRow & { start_date: string | null; planned_end_date: string | null; created_at: string }
  >(
    `SELECT id, status, pre_registered_at, substance_name, metric_name,
            metric_type, metric_direction, block_length_days, num_blocks,
            num_active_blocks, washout_note, start_date, planned_end_date, created_at
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
