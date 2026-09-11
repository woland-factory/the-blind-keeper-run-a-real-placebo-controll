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

describe("POST /api/experiments", () => {
  let ctx: TestApp;
  let cookie: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "creator@example.com");
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  async function countRows(): Promise<{ experiments: number; allocations: number }> {
    const e = await ctx.db.query<{ n: string }>("SELECT count(*)::text AS n FROM experiments");
    const a = await ctx.db.query<{ n: string }>("SELECT count(*)::text AS n FROM allocations");
    return { experiments: Number(e[0].n), allocations: Number(a[0].n) };
  }

  it("rejects an unauthenticated request with 401", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/experiments", payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it("locks a valid design and generates a balanced, allocation-free result", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("prepped");
    expect(body.pre_registered_at).toBeTruthy();
    expect(body.num_active_blocks).toBe(3);
    expect(body.num_blocks).toBe(6);
    expect(body.run_length_days).toBe(30);

    // The DB holds exactly num_blocks balanced allocations with unique codes.
    const allocs = await ctx.db.query<{ block_index: number; code: string; condition: string }>(
      `SELECT a.block_index, a.code, a.condition
         FROM allocations a WHERE a.experiment_id = $1 ORDER BY a.block_index`,
      [body.id]
    );
    expect(allocs).toHaveLength(6);
    expect(allocs.filter((a) => a.condition === "active")).toHaveLength(3);
    expect(allocs.filter((a) => a.condition === "placebo")).toHaveLength(3);
    expect(new Set(allocs.map((a) => a.code)).size).toBe(6);
    expect(allocs.map((a) => a.block_index)).toEqual([0, 1, 2, 3, 4, 5]);

    // The response body carries no secret: no code, no condition label, no
    // "allocation" key.
    const raw = res.body;
    for (const a of allocs) expect(raw).not.toContain(a.code);
    expect(raw.toLowerCase()).not.toContain("placebo");
    expect(raw).not.toContain("allocation");
    expect(raw).not.toContain("condition");
  });

  it("rejects an odd block count with a plain message and writes nothing", async () => {
    const before = await countRows();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: { ...validBody, num_blocks: 7 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("even number of blocks");
    expect(await countRows()).toEqual(before);
  });

  it("rejects a block count below 6", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: { ...validBody, num_blocks: 4 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("rejects a block length outside 3 to 14", async () => {
    const before = await countRows();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: { ...validBody, block_length_days: 2 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("3 to 14");
    expect(await countRows()).toEqual(before);
  });

  it("rejects a client-supplied num_active_blocks that would imbalance the run", async () => {
    const before = await countRows();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: { ...validBody, num_active_blocks: 5 },
    });
    expect(res.statusCode).toBe(400);
    expect(await countRows()).toEqual(before);
  });

  it("rejects a missing acknowledgement", async () => {
    const before = await countRows();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: { ...validBody, acknowledged: false },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("Check the box");
    expect(await countRows()).toEqual(before);
  });

  it("rejects a blocklisted substance with a plain explanation", async () => {
    const before = await countRows();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: { ...validBody, substance_name: "Sertraline" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("prescription drug");
    expect(await countRows()).toEqual(before);
  });
});
