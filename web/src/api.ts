// Thin API client. The server serves the SPA and the API on one origin, so
// relative paths and same-origin cookies are all we need.

export interface ApiError {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  code: string;
  status: number;
  constructor(status: number, error: ApiError) {
    super(error.message);
    this.code = error.code;
    this.status = status;
  }
}

async function parseError(res: Response): Promise<ApiRequestError> {
  let code = "error";
  let message = "Check your connection and try again.";
  try {
    const body = (await res.json()) as { error?: ApiError };
    if (body.error) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    // Non-JSON error: keep the plain fallback message.
  }
  return new ApiRequestError(res.status, { code, message });
}

export async function getMe(): Promise<{ email: string }> {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function requestMagicLink(email: string): Promise<void> {
  const res = await fetch("/api/auth/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw await parseError(res);
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
}

export type MetricType = "rating_0_10" | "minutes" | "count" | "yes_no";
export type MetricDirection = "higher_better" | "lower_better";

export interface Template {
  id: string;
  substance_name: string;
  metric_name: string;
  metric_type: MetricType;
  metric_direction: MetricDirection;
  block_length_days: number;
  num_blocks: number;
  washout_note: string;
}

export interface PreviewInput {
  substance_name?: string;
  metric_type: MetricType;
  block_length_days: number;
  num_blocks: number;
  template_id?: string;
}

export interface Preview {
  num_active_blocks: number;
  num_blank_blocks: number;
  run_length_days: number;
  p_value_floor: number;
  mde: number;
  mde_units: string;
  can_reach_significance: boolean;
  safety: { blocked: boolean; matched_term: string | null };
}

export interface CreateInput {
  substance_name: string;
  metric_name: string;
  metric_type: MetricType;
  metric_direction: MetricDirection;
  block_length_days: number;
  num_blocks: number;
  washout_note: string;
  acknowledged: boolean;
}

export interface Experiment {
  id: string;
  status: string;
  pre_registered_at: string;
  substance_name: string;
  metric_name: string;
  metric_type: MetricType;
  metric_direction: MetricDirection;
  block_length_days: number;
  num_blocks: number;
  num_active_blocks: number;
  run_length_days: number;
  washout_note: string;
  start_date?: string | null;
  planned_end_date?: string | null;
  created_at?: string;
}

export async function getTemplates(): Promise<Template[]> {
  const res = await fetch("/api/experiments/templates", { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()).templates;
}

export async function previewDesign(input: PreviewInput, signal?: AbortSignal): Promise<Preview> {
  const res = await fetch("/api/experiments/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function createExperiment(input: CreateInput): Promise<Experiment> {
  const res = await fetch("/api/experiments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function getExperiment(id: string): Promise<Experiment> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(id)}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export interface PrepBatch {
  label: string;
  contents: string;
}

export interface PrepPacket {
  code: string;
  batch: string;
  count: number;
}

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

export async function getPrep(id: string): Promise<PrepView> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(id)}/prep`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function confirmPrep(id: string): Promise<Experiment> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(id)}/confirm-prep`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export type RunPhase = "prepped" | "running" | "complete" | "voided" | "unblinded";
export type PlaceboGuess = "placebo" | "active" | "unsure";

export interface TodayView {
  id: string;
  status: string;
  phase: RunPhase;
  metric_name: string;
  metric_type: MetricType;
  metric_direction: MetricDirection;
  run_length_days: number;
  day_number: number | null;
  sealed_day_streak: number;
  days_remaining: number;
  today_code: string | null;
  check_in_done: boolean;
}

export interface CheckInInput {
  metric_value: number;
  note: string;
  placebo_guess: PlaceboGuess;
}

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

export async function getToday(id: string): Promise<TodayView> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(id)}/today`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function submitCheckIn(id: string, input: CheckInInput): Promise<TodayView> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(id)}/checkins`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function breakBlind(id: string): Promise<BreakBlindReveal> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(id)}/break-blind`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}
