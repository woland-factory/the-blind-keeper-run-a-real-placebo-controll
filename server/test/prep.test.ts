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

async function lockExperiment(ctx: TestApp, cookie: string): Promise<string> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/experiments",
    headers: { cookie },
    payload: validBody,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("prep read model", () => {
  let ctx: TestApp;
  let cookie: string;
  let id: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "prep-user@example.com");
    id = await lockExperiment(ctx, cookie);
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("returns balanced, interleaved packets and never leaks the schedule", async () => {
    const res = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/prep`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      packets: Array<{ code: string; batch: string; count: number }>;
      batches: Array<{ label: string; contents: string }>;
      capsules_per_code: number;
    };

    // num_blocks packets, unique codes, count = block_length_days.
    expect(body.packets).toHaveLength(N);
    const codes = body.packets.map((p) => p.code);
    expect(new Set(codes).size).toBe(N);
    for (const p of body.packets) {
      expect(["Batch 1", "Batch 2"]).toContain(p.batch);
      expect(p.count).toBe(L);
    }
    expect(body.capsules_per_code).toBe(L);

    // The two batches split the codes evenly.
    const batch1 = body.packets.filter((p) => p.batch === "Batch 1");
    const batch2 = body.packets.filter((p) => p.batch === "Batch 2");
    expect(batch1).toHaveLength(N / 2);
    expect(batch2).toHaveLength(N / 2);

    // Cross-check against the stored allocation: same codes, different order.
    const stored = await ctx.db.query<{ code: string; block_index: number }>(
      `SELECT code, block_index FROM allocations WHERE experiment_id = $1 ORDER BY block_index`,
      [id]
    );
    const storedByIndex = stored.map((r) => r.code);
    expect([...codes].sort()).toEqual([...storedByIndex].sort());
    expect(codes).not.toEqual(storedByIndex); // order is not the block_index order

    // The payload never carries a condition word, a block_index, or a date.
    const raw = res.body;
    expect(raw).not.toContain("active");
    expect(raw).not.toContain("placebo");
    expect(raw).not.toContain("condition");
    expect(raw).not.toContain("block_index");
    expect(raw).not.toContain("block_start_date");
    expect(raw).not.toContain("block_end_date");
    // contents uses the substance name and the neutral word "Blank".
    const contents = body.batches.map((b) => b.contents).sort();
    expect(contents).toEqual(["Blank", "Theanine"]);
  });

  it("is stable across repeated calls", async () => {
    const a = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/prep`, headers: { cookie } });
    const b = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/prep`, headers: { cookie } });
    expect(a.body).toBe(b.body);
  });

  it("guards access: unauth 401, other user 404, non-uuid 404", async () => {
    const unauth = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/prep` });
    expect(unauth.statusCode).toBe(401);

    const other = await signIn(ctx.app, "prep-intruder@example.com");
    const cross = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/prep`, headers: { cookie: other } });
    expect(cross.statusCode).toBe(404);

    const bad = await ctx.app.inject({ method: "GET", url: `/api/experiments/not-a-uuid/prep`, headers: { cookie } });
    expect(bad.statusCode).toBe(404);
  });
});

describe("confirm-ready", () => {
  let ctx: TestApp;
  let cookie: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "confirm-user@example.com");
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("starts the run and sets contiguous block dates from today", async () => {
    const id = await lockExperiment(ctx, cookie);
    const [{ today }] = await ctx.db.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/confirm-prep`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; start_date: string; planned_end_date: string };
    expect(body.status).toBe("running");
    expect(body.start_date).toBe(today);

    // planned_end_date = start_date + L*N - 1.
    const expectedEnd = await ctx.db.query<{ d: string }>(
      `SELECT ($1::date + $2::int)::text AS d`,
      [today, L * N - 1]
    );
    expect(body.planned_end_date).toBe(expectedEnd[0].d);

    // Every allocation has contiguous block dates, block 0 on start_date.
    const allocs = await ctx.db.query<{ block_index: number; block_start_date: string; block_end_date: string }>(
      `SELECT block_index, block_start_date::text AS block_start_date, block_end_date::text AS block_end_date
         FROM allocations WHERE experiment_id = $1 ORDER BY block_index`,
      [id]
    );
    for (const a of allocs) {
      const expected = await ctx.db.query<{ s: string; e: string }>(
        `SELECT ($1::date + ($2::int * $3::int))::text AS s,
                ($1::date + ($2::int * $3::int) + ($3::int - 1))::text AS e`,
        [today, a.block_index, L]
      );
      expect(a.block_start_date).toBe(expected[0].s);
      expect(a.block_end_date).toBe(expected[0].e);
    }
    expect(allocs[0].block_start_date).toBe(today);

    // The response carries no secret. ("active" is skipped: the summary key
    // num_active_blocks is a design count, not a condition label.)
    const raw = res.body;
    expect(raw).not.toContain("placebo");
    expect(raw).not.toContain("condition");
    expect(raw).not.toContain("allocation");
    expect(raw).not.toContain("block_start_date");
  });

  it("is idempotent: a second call changes no date", async () => {
    const id = await lockExperiment(ctx, cookie);
    const first = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });
    expect(first.statusCode).toBe(200);
    const before = await ctx.db.query<{ block_start_date: string }>(
      `SELECT block_start_date::text AS block_start_date FROM allocations WHERE experiment_id = $1 ORDER BY block_index`,
      [id]
    );

    const second = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("running");
    expect(first.json()).toEqual(second.json());

    const after = await ctx.db.query<{ block_start_date: string }>(
      `SELECT block_start_date::text AS block_start_date FROM allocations WHERE experiment_id = $1 ORDER BY block_index`,
      [id]
    );
    expect(after).toEqual(before);
  });

  it("refuses a finished run with 422 and changes no rows", async () => {
    const id = await lockExperiment(ctx, cookie);
    await ctx.db.query(`UPDATE experiments SET status = 'voided' WHERE id = $1`, [id]);
    const before = await ctx.db.query(
      `SELECT block_start_date FROM allocations WHERE experiment_id = $1`,
      [id]
    );

    const res = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("invalid_state");
    expect(res.json().error.message).toBe("This run has already finished.");

    const after = await ctx.db.query(
      `SELECT block_start_date FROM allocations WHERE experiment_id = $1`,
      [id]
    );
    expect(after).toEqual(before);
    const status = await ctx.db.query<{ status: string }>(`SELECT status FROM experiments WHERE id = $1`, [id]);
    expect(status[0].status).toBe("voided");
  });

  it("guards access: unauth 401, other user 404", async () => {
    const id = await lockExperiment(ctx, cookie);
    const unauth = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep` });
    expect(unauth.statusCode).toBe(401);

    const other = await signIn(ctx.app, "confirm-intruder@example.com");
    const cross = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie: other } });
    expect(cross.statusCode).toBe(404);
  });

  it("seals the fill map once the run is running", async () => {
    const id = await lockExperiment(ctx, cookie);

    // While prepped, the map is served in full.
    const prepped = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/prep`, headers: { cookie } });
    expect(prepped.statusCode).toBe(200);
    expect((prepped.json() as { packets: unknown[] }).packets).toHaveLength(N);

    const codes = (
      await ctx.db.query<{ code: string }>(`SELECT code FROM allocations WHERE experiment_id = $1`, [id])
    ).map((r) => r.code);

    // Start the run, then re-read prep.
    const confirm = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });
    expect(confirm.statusCode).toBe(200);

    const sealed = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/prep`, headers: { cookie } });
    expect(sealed.statusCode).toBe(200);
    const body = sealed.json() as { status: string; batches: unknown[]; packets: unknown[] };
    expect(body.status).toBe("running");
    // The one-time fill map is gone: no batches, no packets, no codes on the wire.
    expect(body.batches).toEqual([]);
    expect(body.packets).toEqual([]);
    for (const code of codes) expect(sealed.body).not.toContain(code);
    expect(sealed.body).not.toContain("Batch 1");
    expect(sealed.body).not.toContain("Batch 2");
    expect(sealed.body).not.toContain("Blank");
  });

  it("keeps the design sealed after confirm-ready", async () => {
    const id = await lockExperiment(ctx, cookie);
    const res = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    // A frozen column still cannot be changed: confirm-ready did not weaken the seal.
    await expect(
      ctx.db.query(`UPDATE experiments SET metric_name = 'Changed' WHERE id = $1`, [id])
    ).rejects.toThrow();
  });
});
