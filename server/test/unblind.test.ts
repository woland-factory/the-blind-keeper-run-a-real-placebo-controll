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

async function lock(ctx: TestApp, cookie: string): Promise<string> {
  const res = await ctx.app.inject({ method: "POST", url: "/api/experiments", headers: { cookie }, payload: validBody });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function lockAndRun(ctx: TestApp, cookie: string): Promise<string> {
  const id = await lock(ctx, cookie);
  const confirm = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });
  expect(confirm.statusCode).toBe(200);
  return id;
}

async function completeRun(ctx: TestApp, cookie: string, id: string): Promise<void> {
  const res = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/complete-run`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
}

describe("unblind + verdict", () => {
  let ctx: TestApp;
  let cookie: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "unblind-user@example.com");
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("happy path: unblinds a complete run, stores one verdict, serves the 2.6 shape", async () => {
    const id = await lockAndRun(ctx, cookie);
    await completeRun(ctx, cookie, id);

    const res = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/unblind`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const view = res.json();

    expect(view.status).toBe("unblinded");
    // DB reflects the flip and exactly one verdict row.
    const exp = await ctx.db.query<{ status: string }>(`SELECT status FROM experiments WHERE id = $1`, [id]);
    expect(exp[0].status).toBe("unblinded");
    const count = await ctx.db.query<{ n: string }>(`SELECT count(*) AS n FROM verdicts WHERE experiment_id = $1`, [id]);
    expect(Number(count[0].n)).toBe(1);

    // Numbers are numbers, not strings.
    const v = view.verdict;
    expect(typeof v.effect_estimate).toBe("number");
    expect(typeof v.permutation_p_value).toBe("number");
    expect(typeof v.p_value_floor).toBe("number");
    expect(typeof v.adherence_pct).toBe("number");
    expect(typeof v.guess_days_scored).toBe("number");
    expect(typeof v.days_logged).toBe("number");
    expect(typeof v.significant).toBe("boolean");
    expect(typeof v.guesses_beat_chance).toBe("boolean");
    expect(typeof v.blind_integrity_flag).toBe("boolean");
    expect(typeof v.verdict_text).toBe("string");
    expect(typeof v.guess_text).toBe("string");

    // The 2.7 backfill guarantees a strong signal and perfect guessing.
    expect(v.significant).toBe(true);
    expect(v.guesses_beat_chance).toBe(true);
    expect(v.days_logged).toBe(30);
    expect(v.adherence_pct).toBe(100);

    // blocks equal the stored allocations in block order, with contents mapped.
    const stored = await ctx.db.query<{
      code: string;
      condition: string;
      block_start_date: string;
      block_end_date: string;
    }>(
      `SELECT code, condition, block_start_date::text AS block_start_date, block_end_date::text AS block_end_date
         FROM allocations WHERE experiment_id = $1 ORDER BY block_index`,
      [id]
    );
    expect(view.blocks).toHaveLength(stored.length);
    view.blocks.forEach((b: { code: string; contents: string; block_start_date: string; block_end_date: string }, i: number) => {
      expect(b.code).toBe(stored[i].code);
      expect(b.contents).toBe(stored[i].condition === "active" ? "Theanine" : "Blank");
      expect(b.block_start_date).toBe(stored[i].block_start_date);
      expect(b.block_end_date).toBe(stored[i].block_end_date);
    });
  });

  it("compute-once: a second unblind and GET /verdict serve the same stored result", async () => {
    const id = await lockAndRun(ctx, cookie);
    await completeRun(ctx, cookie, id);

    const first = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/unblind`, headers: { cookie } });
    expect(first.statusCode).toBe(200);
    const firstComputedAt = first.json().verdict.computed_at as string;

    const second = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/unblind`, headers: { cookie } });
    expect(second.statusCode).toBe(200);
    expect(second.json().verdict.computed_at).toBe(firstComputedAt);
    expect(second.json()).toEqual(first.json());

    const get = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/verdict`, headers: { cookie } });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual(first.json());

    const count = await ctx.db.query<{ n: string }>(`SELECT count(*) AS n FROM verdicts WHERE experiment_id = $1`, [id]);
    expect(Number(count[0].n)).toBe(1);
  });

  it("gating: mid-run, prepped, and voided are refused with the 2.10 messages", async () => {
    // Mid-run (running, still inside the window).
    const running = await lockAndRun(ctx, cookie);
    const mid = await ctx.app.inject({ method: "POST", url: `/api/experiments/${running}/unblind`, headers: { cookie } });
    expect(mid.statusCode).toBe(422);
    expect(mid.json().error.message).toBe("Your run is still going. Finish every block first.");
    const midGet = await ctx.app.inject({ method: "GET", url: `/api/experiments/${running}/verdict`, headers: { cookie } });
    expect(midGet.statusCode).toBe(422);
    expect(midGet.json().error.message).toBe("Finish the run, then reveal the verdict.");

    // Prepped (not started).
    const prepped = await lock(ctx, cookie);
    const p = await ctx.app.inject({ method: "POST", url: `/api/experiments/${prepped}/unblind`, headers: { cookie } });
    expect(p.statusCode).toBe(422);
    expect(p.json().error.message).toBe("This run has not started.");
    const pGet = await ctx.app.inject({ method: "GET", url: `/api/experiments/${prepped}/verdict`, headers: { cookie } });
    expect(pGet.statusCode).toBe(422);
    expect(pGet.json().error.message).toBe("Finish the run, then reveal the verdict.");

    // Voided (broke the blind).
    const voided = await lockAndRun(ctx, cookie);
    await ctx.app.inject({ method: "POST", url: `/api/experiments/${voided}/break-blind`, headers: { cookie } });
    const v = await ctx.app.inject({ method: "POST", url: `/api/experiments/${voided}/unblind`, headers: { cookie } });
    expect(v.statusCode).toBe(422);
    expect(v.json().error.message).toBe("You broke the blind, so this run has no verdict.");
    const vGet = await ctx.app.inject({ method: "GET", url: `/api/experiments/${voided}/verdict`, headers: { cookie } });
    expect(vGet.statusCode).toBe(422);
    expect(vGet.json().error.message).toBe("You broke the blind, so this run has no verdict.");
    const count = await ctx.db.query<{ n: string }>(`SELECT count(*) AS n FROM verdicts WHERE experiment_id = $1`, [voided]);
    expect(Number(count[0].n)).toBe(0);
  });

  it("GET /verdict on a complete-but-sealed run asks the user to reveal first", async () => {
    const id = await lockAndRun(ctx, cookie);
    await completeRun(ctx, cookie, id);
    const get = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/verdict`, headers: { cookie } });
    expect(get.statusCode).toBe(422);
    expect(get.json().error.message).toBe("Your run is complete. Reveal the verdict first.");
  });

  it("guards access: unauth 401, other user 404, non-uuid 404", async () => {
    const id = await lockAndRun(ctx, cookie);
    await completeRun(ctx, cookie, id);

    const unauth = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/unblind` });
    expect(unauth.statusCode).toBe(401);
    const unauthGet = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/verdict` });
    expect(unauthGet.statusCode).toBe(401);

    const other = await signIn(ctx.app, "unblind-intruder@example.com");
    const cross = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/unblind`, headers: { cookie: other } });
    expect(cross.statusCode).toBe(404);
    const crossGet = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/verdict`, headers: { cookie: other } });
    expect(crossGet.statusCode).toBe(404);

    const bad = await ctx.app.inject({ method: "GET", url: `/api/experiments/not-a-uuid/verdict`, headers: { cookie } });
    expect(bad.statusCode).toBe(404);
    const badPost = await ctx.app.inject({ method: "POST", url: `/api/experiments/not-a-uuid/unblind`, headers: { cookie } });
    expect(badPost.statusCode).toBe(404);
  });

  it("no network call happens anywhere in the verdict path", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("no network allowed in the verdict path");
    }) as typeof fetch;
    try {
      const id = await lockAndRun(ctx, cookie);
      await completeRun(ctx, cookie, id);
      const unblind = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/unblind`, headers: { cookie } });
      expect(unblind.statusCode).toBe(200);
      const get = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/verdict`, headers: { cookie } });
      expect(get.statusCode).toBe(200);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("the immutability seal outlives the status flip", async () => {
    const id = await lockAndRun(ctx, cookie);
    await completeRun(ctx, cookie, id);
    await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/unblind`, headers: { cookie } });
    await expect(
      ctx.db.query(`UPDATE experiments SET metric_name = 'Changed' WHERE id = $1`, [id])
    ).rejects.toThrow();
  });

  it("dev complete-run shifts the calendar, backfills every day, and reads complete", async () => {
    const id = await lockAndRun(ctx, cookie);

    const before = await ctx.db.query<{ start_date: string; planned_end_date: string }>(
      `SELECT start_date::text AS start_date, planned_end_date::text AS planned_end_date FROM experiments WHERE id = $1`,
      [id]
    );
    await completeRun(ctx, cookie, id);
    const after = await ctx.db.query<{ start_date: string; planned_end_date: string }>(
      `SELECT start_date::text AS start_date, planned_end_date::text AS planned_end_date FROM experiments WHERE id = $1`,
      [id]
    );
    // Shifted back a full run length (5 * 6 = 30 days).
    const daysBetween = (a: string, b: string) =>
      Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000);
    expect(daysBetween(before[0].start_date, after[0].start_date)).toBe(30);
    expect(daysBetween(before[0].planned_end_date, after[0].planned_end_date)).toBe(30);

    // Every run day now has a check-in.
    const checks = await ctx.db.query<{ n: string }>(`SELECT count(*) AS n FROM check_ins WHERE experiment_id = $1`, [id]);
    expect(Number(checks[0].n)).toBe(30);

    // GET /today reads complete.
    const today = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/today`, headers: { cookie } });
    expect(today.json().phase).toBe("complete");

    // Refuses a run that has not started (the guard is on running only).
    const prepped = await lock(ctx, cookie);
    const notStarted = await ctx.app.inject({ method: "POST", url: `/api/experiments/${prepped}/complete-run`, headers: { cookie } });
    expect(notStarted.statusCode).toBe(422);
    expect(notStarted.json().error.message).toBe("This run has not started.");
  });

  it("complete-run is registered only under the console transport", async () => {
    const someId = "11111111-1111-4111-8111-111111111111";
    // Under console the route exists, so an unauthenticated hit is a 401.
    const onConsole = await ctx.app.inject({ method: "POST", url: `/api/experiments/${someId}/complete-run` });
    expect(onConsole.statusCode).toBe(401);

    // Under central the route is not registered at all, so it is a 404.
    const central = await buildTestApp({ MAIL_TRANSPORT: "central" });
    try {
      const res = await central.app.inject({ method: "POST", url: `/api/experiments/${someId}/complete-run` });
      expect(res.statusCode).toBe(404);
    } finally {
      await central.app.close();
      await central.db.close();
    }
  });
});
