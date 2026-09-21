import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, signIn, type TestApp } from "./helpers.js";
import { minimumDetectableEffect, pooledWithinSd } from "../src/power.js";

const runBody = {
  substance_name: "Theanine",
  metric_name: "Afternoon focus",
  metric_type: "rating_0_10",
  metric_direction: "higher_better",
  block_length_days: 5,
  num_blocks: 6,
  washout_note: "Skip 1 day between blocks.",
  acknowledged: true,
};

async function lockRun(ctx: TestApp, cookie: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/experiments",
    headers: { cookie },
    payload: { ...runBody, ...overrides },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  const confirm = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });
  expect(confirm.statusCode).toBe(200);
  return id;
}

/**
 * Complete and unblind a run, then overwrite its check-ins with a fixed pattern
 * that has real within-block spread (the dev backfill fills each block with one
 * constant value, so it carries zero within-block noise). Returns the id.
 */
async function completeWithSpread(ctx: TestApp, cookie: string, id: string): Promise<string> {
  await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/complete-run`, headers: { cookie } });
  const start = (
    await ctx.db.query<{ start_date: string }>(
      `SELECT start_date::text AS start_date FROM experiments WHERE id = $1`,
      [id]
    )
  )[0].start_date;
  // Values 0,2,4,6,8 cycling through each 5-day block: a clear within-block SD.
  await ctx.db.query(
    `UPDATE check_ins SET metric_value = ((check_date - $2::date) % 5) * 2 WHERE experiment_id = $1`,
    [id, start]
  );
  const unblind = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/unblind`, headers: { cookie } });
  expect(unblind.statusCode).toBe(200);
  return id;
}

/** Recompute the user's measured within-block SD for a finished run, independently. */
async function measuredSdFor(ctx: TestApp, id: string): Promise<number | null> {
  const rows = await ctx.db.query<{ block_index: number; metric_value: string }>(
    `SELECT a.block_index, c.metric_value
       FROM allocations a
       JOIN check_ins c ON c.experiment_id = a.experiment_id
                       AND c.check_date BETWEEN a.block_start_date AND a.block_end_date
      WHERE a.experiment_id = $1`,
    [id]
  );
  const byBlock = new Map<number, number[]>();
  for (const r of rows) {
    const list = byBlock.get(r.block_index) ?? [];
    list.push(Number(r.metric_value));
    byBlock.set(r.block_index, list);
  }
  return pooledWithinSd([...byBlock.values()]);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

describe("POST /api/experiments/preview", () => {
  let ctx: TestApp;
  let cookie: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "preview@example.com");
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("requires authentication", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments/preview",
      payload: { metric_type: "rating_0_10", block_length_days: 5, num_blocks: 6 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns the power statement fields for a candidate design and writes nothing", async () => {
    const before = await ctx.db.query<{ n: string }>("SELECT count(*)::text AS n FROM experiments");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments/preview",
      headers: { cookie },
      payload: {
        substance_name: "Theanine",
        metric_type: "rating_0_10",
        block_length_days: 5,
        num_blocks: 6,
        template_id: "theanine",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.num_active_blocks).toBe(3);
    expect(body.num_blank_blocks).toBe(3);
    expect(body.run_length_days).toBe(30);
    expect(body.p_value_floor).toBeCloseTo(0.05, 10);
    expect(body.mde).toBe(1.4);
    expect(body.mde_units).toBe("points");
    expect(body.can_reach_significance).toBe(true);
    expect(body.noise_source).toBe("assumed");
    expect(body.safety).toEqual({ blocked: false, matched_term: null });

    const after = await ctx.db.query<{ n: string }>("SELECT count(*)::text AS n FROM experiments");
    expect(after[0].n).toBe(before[0].n);
  });

  it("reports a blocklisted candidate with the matched term", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments/preview",
      headers: { cookie },
      payload: {
        substance_name: "Adderall",
        metric_type: "rating_0_10",
        block_length_days: 5,
        num_blocks: 6,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().safety).toEqual({ blocked: true, matched_term: "adderall" });
  });

  it("rejects an odd block count with a 400 envelope", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments/preview",
      headers: { cookie },
      payload: { metric_type: "rating_0_10", block_length_days: 5, num_blocks: 7 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_input");
  });

  it("uses measured noise once the user has completed a run of the metric", async () => {
    const owner = await signIn(ctx.app, "measured-owner@example.com");
    const id = await lockRun(ctx, owner);
    await completeWithSpread(ctx, owner, id);

    const sd = await measuredSdFor(ctx, id);
    expect(sd).not.toBeNull();
    const expectedMde = round1(
      minimumDetectableEffect({ assumedWithinSd: sd as number, blockLengthDays: 5, numActive: 3, numBlank: 3 })
    );

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments/preview",
      headers: { cookie: owner },
      payload: {
        metric_type: "rating_0_10",
        block_length_days: 5,
        num_blocks: 6,
        metric_name: "Afternoon focus",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().noise_source).toBe("measured");
    expect(res.json().mde).toBe(expectedMde);
    // The measured spread here is wider than the assumption, so the MDE moved.
    expect(res.json().mde).not.toBe(1.4);

    // A different metric name (no history) falls back to the assumption.
    const other = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments/preview",
      headers: { cookie: owner },
      payload: { metric_type: "rating_0_10", block_length_days: 5, num_blocks: 6, metric_name: "Sleep depth" },
    });
    expect(other.json().noise_source).toBe("assumed");
    expect(other.json().mde).toBe(1.4);
  });

  it("ignores voided history and never crosses users", async () => {
    // A run the user voided leaves compromised data that must not tune anything.
    const voider = await signIn(ctx.app, "measured-voider@example.com");
    const voidedId = await lockRun(ctx, voider);
    await ctx.app.inject({ method: "POST", url: `/api/experiments/${voidedId}/break-blind`, headers: { cookie: voider } });
    const voidedPreview = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments/preview",
      headers: { cookie: voider },
      payload: { metric_type: "rating_0_10", block_length_days: 5, num_blocks: 6, metric_name: "Afternoon focus" },
    });
    expect(voidedPreview.json().noise_source).toBe("assumed");

    // Another user completed "Afternoon focus"; a fresh user must not inherit it.
    const completer = await signIn(ctx.app, "measured-a@example.com");
    const completed = await lockRun(ctx, completer);
    await completeWithSpread(ctx, completer, completed);

    const fresh = await signIn(ctx.app, "measured-fresh@example.com");
    const freshPreview = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments/preview",
      headers: { cookie: fresh },
      payload: { metric_type: "rating_0_10", block_length_days: 5, num_blocks: 6, metric_name: "Afternoon focus" },
    });
    expect(freshPreview.json().noise_source).toBe("assumed");
    expect(freshPreview.json().mde).toBe(1.4);
  });
});
