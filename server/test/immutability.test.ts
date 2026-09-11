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

describe("pre-registered experiments are immutable at the database", () => {
  let ctx: TestApp;
  let cookie: string;
  let experimentId: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "sealer@example.com");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: validBody,
    });
    experimentId = res.json().id as string;
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("rejects a direct UPDATE of a frozen column", async () => {
    await expect(
      ctx.db.query(`UPDATE experiments SET metric_name = 'Changed' WHERE id = $1`, [experimentId])
    ).rejects.toThrow();
    await expect(
      ctx.db.query(`UPDATE experiments SET num_blocks = 8 WHERE id = $1`, [experimentId])
    ).rejects.toThrow();
  });

  it("allows an UPDATE of status, start_date, and planned_end_date", async () => {
    await expect(
      ctx.db.query(
        `UPDATE experiments
            SET status = 'running', start_date = '2026-10-01', planned_end_date = '2026-10-31'
          WHERE id = $1`,
        [experimentId]
      )
    ).resolves.toBeDefined();
    const rows = await ctx.db.query<{ status: string }>(
      `SELECT status FROM experiments WHERE id = $1`,
      [experimentId]
    );
    expect(rows[0].status).toBe("running");
  });

  it("rejects clearing pre_registered_at", async () => {
    await expect(
      ctx.db.query(`UPDATE experiments SET pre_registered_at = NULL WHERE id = $1`, [experimentId])
    ).rejects.toThrow();
  });

  it("has no mutation route: PATCH and PUT to /api/experiments/:id return 404", async () => {
    const patch = await ctx.app.inject({
      method: "PATCH",
      url: `/api/experiments/${experimentId}`,
      headers: { cookie },
      payload: { metric_name: "Changed" },
    });
    expect(patch.statusCode).toBe(404);
    const put = await ctx.app.inject({
      method: "PUT",
      url: `/api/experiments/${experimentId}`,
      headers: { cookie },
      payload: { metric_name: "Changed" },
    });
    expect(put.statusCode).toBe(404);
  });
});
