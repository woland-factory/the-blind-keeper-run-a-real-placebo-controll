import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, signIn, type TestApp } from "./helpers.js";

const validBody = {
  substance_name: "Theanine",
  metric_name: "Afternoon focus",
  metric_type: "rating_0_10",
  metric_direction: "higher_better",
  block_length_days: 5,
  num_blocks: 6,
  washout_note: "Skip 1 day between blocks.",
  acknowledged: true,
};

const L = validBody.block_length_days;
const N = validBody.num_blocks;

async function lock(ctx: TestApp, cookie: string): Promise<string> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/experiments",
    headers: { cookie },
    payload: validBody,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function confirm(ctx: TestApp, cookie: string, id: string): Promise<void> {
  const res = await ctx.app.inject({
    method: "POST",
    url: `/api/experiments/${id}/confirm-prep`,
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
}

describe("GET /today read model", () => {
  let ctx: TestApp;
  let cookie: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "today-user@example.com");
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("returns today's code and progress for a running experiment, and no secret", async () => {
    const id = await lock(ctx, cookie);
    await confirm(ctx, cookie, id);

    // Block 0's stored code: today is start_date, so today_code must equal it.
    const stored = await ctx.db.query<{ code: string; block_index: number }>(
      `SELECT code, block_index FROM allocations WHERE experiment_id = $1 ORDER BY block_index`,
      [id]
    );
    const block0Code = stored.find((s) => s.block_index === 0)!.code;

    const res = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/today`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      phase: string;
      today_code: string;
      check_in_done: boolean;
      day_number: number;
      sealed_day_streak: number;
      days_remaining: number;
      run_length_days: number;
    };
    expect(body.phase).toBe("running");
    expect(body.today_code).toBe(block0Code);
    expect(body.check_in_done).toBe(false);
    expect(body.day_number).toBe(1);
    expect(body.sealed_day_streak).toBe(1);
    expect(body.days_remaining).toBe(L * N - 1);
    expect(body.run_length_days).toBe(L * N);

    // Blind-safe: no condition, no block_index, no block date, and no code other
    // than today_code.
    const raw = res.body;
    expect(raw).not.toContain("condition");
    expect(raw).not.toContain("block_index");
    expect(raw).not.toContain("block_start_date");
    expect(raw).not.toContain("block_end_date");
    expect(raw.toLowerCase()).not.toContain("placebo");
    for (const s of stored) {
      if (s.code === block0Code) continue;
      expect(raw).not.toContain(s.code);
    }
  });

  it("is blind-safe with a null code in every non-running status", async () => {
    // voided (allowed by the trigger via a direct status update).
    const voided = await lock(ctx, cookie);
    await confirm(ctx, cookie, voided);
    await ctx.db.query(`UPDATE experiments SET status = 'voided' WHERE id = $1`, [voided]);
    const vRes = await ctx.app.inject({ method: "GET", url: `/api/experiments/${voided}/today`, headers: { cookie } });
    expect(vRes.statusCode).toBe(200);
    const vBody = vRes.json() as { phase: string; today_code: string | null };
    expect(vBody.phase).toBe("voided");
    expect(vBody.today_code).toBeNull();
    expect(vRes.body.toLowerCase()).not.toContain("placebo");
    expect(vRes.body).not.toContain("condition");

    // prepped (freshly locked, never confirmed).
    const prepped = await lock(ctx, cookie);
    const pRes = await ctx.app.inject({ method: "GET", url: `/api/experiments/${prepped}/today`, headers: { cookie } });
    expect(pRes.statusCode).toBe(200);
    const pBody = pRes.json() as { phase: string; today_code: string | null };
    expect(pBody.phase).toBe("prepped");
    expect(pBody.today_code).toBeNull();

    // unblinded (direct status update).
    const unblinded = await lock(ctx, cookie);
    await confirm(ctx, cookie, unblinded);
    await ctx.db.query(`UPDATE experiments SET status = 'unblinded' WHERE id = $1`, [unblinded]);
    const uRes = await ctx.app.inject({ method: "GET", url: `/api/experiments/${unblinded}/today`, headers: { cookie } });
    const uBody = uRes.json() as { phase: string; today_code: string | null };
    expect(uBody.phase).toBe("unblinded");
    expect(uBody.today_code).toBeNull();
  });

  it("guards access: unauth 401, other user 404, non-uuid 404", async () => {
    const id = await lock(ctx, cookie);
    const unauth = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/today` });
    expect(unauth.statusCode).toBe(401);

    const other = await signIn(ctx.app, "today-intruder@example.com");
    const cross = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/today`, headers: { cookie: other } });
    expect(cross.statusCode).toBe(404);

    const bad = await ctx.app.inject({ method: "GET", url: `/api/experiments/not-a-uuid/today`, headers: { cookie } });
    expect(bad.statusCode).toBe(404);
  });
});
