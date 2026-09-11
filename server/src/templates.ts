import type { MetricType, MetricDirection } from "./metrics.js";

// A small, hand-curated starter set so the design screen is concrete on first
// open. `assumed_within_sd` is a server-internal power input and is never sent
// to the client (see publicTemplates).

export interface Template {
  id: string;
  substance_name: string;
  metric_name: string;
  metric_type: MetricType;
  metric_direction: MetricDirection;
  block_length_days: number;
  num_blocks: number;
  washout_note: string;
  assumed_within_sd: number;
}

export type PublicTemplate = Omit<Template, "assumed_within_sd">;

export const TEMPLATES: Template[] = [
  {
    id: "theanine",
    substance_name: "Theanine",
    metric_name: "Afternoon focus",
    metric_type: "rating_0_10",
    metric_direction: "higher_better",
    block_length_days: 5,
    num_blocks: 6,
    washout_note: "Skip 1 day between blocks.",
    assumed_within_sd: 1.5,
  },
  {
    id: "magnesium",
    substance_name: "Magnesium glycinate",
    metric_name: "Sleep quality",
    metric_type: "rating_0_10",
    metric_direction: "higher_better",
    block_length_days: 7,
    num_blocks: 6,
    washout_note: "Skip 1 day between blocks.",
    assumed_within_sd: 1.5,
  },
  {
    id: "melatonin",
    substance_name: "Melatonin",
    metric_name: "Minutes to fall asleep",
    metric_type: "minutes",
    metric_direction: "lower_better",
    block_length_days: 5,
    num_blocks: 6,
    washout_note: "Skip 1 day between blocks.",
    assumed_within_sd: 15,
  },
  {
    id: "creatine",
    substance_name: "Creatine",
    metric_name: "Reps at your usual weight",
    metric_type: "count",
    metric_direction: "higher_better",
    block_length_days: 7,
    num_blocks: 6,
    washout_note: "Skip 1 day between blocks.",
    assumed_within_sd: 2,
  },
  {
    id: "ashwagandha",
    substance_name: "Ashwagandha",
    metric_name: "Felt calm today",
    metric_type: "yes_no",
    metric_direction: "higher_better",
    block_length_days: 7,
    num_blocks: 6,
    washout_note: "Skip 1 day between blocks.",
    assumed_within_sd: 0.5,
  },
];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Templates with the internal power input stripped, safe to send to a client. */
export function publicTemplates(): PublicTemplate[] {
  return TEMPLATES.map(({ assumed_within_sd: _sd, ...rest }) => rest);
}
