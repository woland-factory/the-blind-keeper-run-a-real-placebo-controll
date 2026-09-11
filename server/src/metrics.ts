// Single source of truth for the metric model. Reused by the power estimate,
// the create/preview routes, and (later) the verdict engine.

export const METRIC_TYPES = ["rating_0_10", "minutes", "count", "yes_no"] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export const METRIC_DIRECTIONS = ["higher_better", "lower_better"] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

// Display units per metric type, used in the power statement now and the verdict
// later.
export const METRIC_UNITS: Record<MetricType, string> = {
  rating_0_10: "points",
  minutes: "minutes",
  count: "counts",
  yes_no: "percentage points",
};

// Assumed within-person day-to-day spread (standard deviation, metric units)
// when no template is chosen. A stated design-time assumption only. EPIC 6
// replaces it with the user's measured noise.
export const DEFAULT_WITHIN_SD: Record<MetricType, number> = {
  rating_0_10: 1.5,
  minutes: 15,
  count: 2,
  yes_no: 0.5,
};
