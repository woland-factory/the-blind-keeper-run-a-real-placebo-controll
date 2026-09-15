import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, signIn, type TestApp } from "./helpers.js";

function bodyFor(metricType: string) {
  return {
    substance_name: "Theanine",
    metric_name: "Afternoon focus",
    metric_type: metricType,
    metric_direction: "higher_better",
    block_length_days: 5,
    num_blocks: 6,
    washout_note: "Skip 1 day between blocks.",
    acknowledged: true,
  };
}

async function lockAndRun(ctx: TestApp, cookie: string, metricType = "rating_0_10"): Promise<string> {
  const create = await ctx.app.inject({
    method: "POST",
    url: "/api/experiments",
    headers: { cookie },
    payload: bodyFor(metricType),
  });
  expect(create.statusCode).toBe(201);
  const id = create.json().id as string;
  const confirm = await ctx.app.inject({
    method: "POST",
    url: `/api/experiments/${id}/confirm-prep`,
    headers: { cookie },
  });
  expect(confirm.statusCode).toBe(200);
  return id;
}

describe("POST /checkins", () => {
  let ctx: TestApp;
  let cookie: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "checkin-user@example.com");
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("records one row for today and returns the refreshed done payload", async () => {
    const id = await lockAndRun(ctx, cookie);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/checkins`,
      headers: { cookie },
      payload: { metric_value: 7, note: "Felt sharp", placebo_guess: "active" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().check_in_done).toBe(true);

    const [{ today }] = await ctx.db.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
    const rows = await ctx.db.query<{
      n: number;
      check_date: string;
      placebo_guess: string;
      metric_value: string;
    }>(
      `SELECT check_date::text AS check_date, placebo_guess, metric_value
         FROM check_ins WHERE experiment_id = $1`,
      [id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].check_date).toBe(today);
    expect(rows[0].placebo_guess).toBe("active");
    expect(Number(rows[0].metric_value)).toBe(7);

    // Blind-safe response.
    const raw = res.body;
    expect(raw).not.toContain("condition");
    expect(raw).not.toContain("block_index");
    expect(raw).not.toContain("block_start_date");
    expect(raw.toLowerCase()).not.toContain("placebo");
    const stored = await ctx.db.query<{ code: string }>(
      `SELECT code FROM allocations WHERE experiment_id = $1`,
      [id]
    );
    const todayCode = res.json().today_code as string;
    for (const s of stored) {
      if (s.code === todayCode) continue;
      expect(raw).not.toContain(s.code);
    }
  });

  it("rejects a second check-in the same day and never edits the first", async () => {
    const id = await lockAndRun(ctx, cookie);
    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/checkins`,
      headers: { cookie },
      payload: { metric_value: 4, note: "First", placebo_guess: "placebo" },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/checkins`,
      headers: { cookie },
      payload: { metric_value: 9, note: "Second", placebo_guess: "active" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("already_checked_in");
    expect(second.json().error.message).toBe("You already checked in today.");

    const rows = await ctx.db.query<{ metric_value: string; placebo_guess: string; note: string }>(
      `SELECT metric_value, placebo_guess, note FROM check_ins WHERE experiment_id = $1`,
      [id]
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].metric_value)).toBe(4);
    expect(rows[0].placebo_guess).toBe("placebo");
    expect(rows[0].note).toBe("First");
  });

  it("validates the metric value by type with a plain message", async () => {
    const rating = await lockAndRun(ctx, cookie, "rating_0_10");
    const r = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${rating}/checkins`,
      headers: { cookie },
      payload: { metric_value: 11, placebo_guess: "unsure" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.message).toBe("Use a score from 0 to 10.");

    const minutes = await lockAndRun(ctx, cookie, "minutes");
    const m = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${minutes}/checkins`,
      headers: { cookie },
      payload: { metric_value: -1, placebo_guess: "unsure" },
    });
    expect(m.statusCode).toBe(422);
    expect(m.json().error.message).toBe("Use a number of minutes from 0 to 1440.");

    const count = await lockAndRun(ctx, cookie, "count");
    const c = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${count}/checkins`,
      headers: { cookie },
      payload: { metric_value: 1.5, placebo_guess: "unsure" },
    });
    expect(c.statusCode).toBe(422);
    expect(c.json().error.message).toBe("Use a whole number from 0 to 10000.");

    const yesno = await lockAndRun(ctx, cookie, "yes_no");
    const y = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${yesno}/checkins`,
      headers: { cookie },
      payload: { metric_value: 2, placebo_guess: "unsure" },
    });
    expect(y.statusCode).toBe(422);
    expect(y.json().error.message).toBe("Choose yes or no.");
  });

  it("rejects a malformed body and an extra client-supplied field", async () => {
    const id = await lockAndRun(ctx, cookie);
    // A client-supplied check_date is refused by .strict().
    const extra = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/checkins`,
      headers: { cookie },
      payload: { metric_value: 5, placebo_guess: "active", check_date: "2020-01-01" },
    });
    expect(extra.statusCode).toBe(400);

    // A non-numeric metric_value.
    const bad = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/checkins`,
      headers: { cookie },
      payload: { metric_value: "seven", placebo_guess: "active" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toBe("Check your entry and try again.");

    // No row was written by either bad request.
    const rows = await ctx.db.query(`SELECT id FROM check_ins WHERE experiment_id = $1`, [id]);
    expect(rows).toHaveLength(0);
  });

  it("guards state: no check-in on a voided or prepped experiment", async () => {
    const voided = await lockAndRun(ctx, cookie);
    await ctx.db.query(`UPDATE experiments SET status = 'voided' WHERE id = $1`, [voided]);
    const v = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${voided}/checkins`,
      headers: { cookie },
      payload: { metric_value: 5, placebo_guess: "active" },
    });
    expect(v.statusCode).toBe(422);
    expect(v.json().error.code).toBe("invalid_state");
    expect(v.json().error.message).toBe("This run has already finished.");
    expect(await ctx.db.query(`SELECT id FROM check_ins WHERE experiment_id = $1`, [voided])).toHaveLength(0);

    // prepped: freshly locked, never confirmed.
    const create = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: bodyFor("rating_0_10"),
    });
    const prepped = create.json().id as string;
    const p = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${prepped}/checkins`,
      headers: { cookie },
      payload: { metric_value: 5, placebo_guess: "active" },
    });
    expect(p.statusCode).toBe(422);
    expect(p.json().error.message).toBe("This run has not started.");
    expect(await ctx.db.query(`SELECT id FROM check_ins WHERE experiment_id = $1`, [prepped])).toHaveLength(0);
  });

  it("guards access: unauth 401, other user 404", async () => {
    const id = await lockAndRun(ctx, cookie);
    const unauth = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/checkins`,
      payload: { metric_value: 5, placebo_guess: "active" },
    });
    expect(unauth.statusCode).toBe(401);

    const other = await signIn(ctx.app, "checkin-intruder@example.com");
    const cross = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/checkins`,
      headers: { cookie: other },
      payload: { metric_value: 5, placebo_guess: "active" },
    });
    expect(cross.statusCode).toBe(404);
  });
});
