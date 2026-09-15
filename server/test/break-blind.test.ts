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

interface Reveal {
  status: string;
  broke_blind_at: string | null;
  substance_name: string;
  blocks: Array<{ code: string; contents: string; block_start_date: string; block_end_date: string }>;
}

describe("POST /break-blind", () => {
  let ctx: TestApp;
  let cookie: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "break-user@example.com");
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("voids the run and reveals the true schedule in block order", async () => {
    const id = await lockAndRun(ctx, cookie);
    const res = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/break-blind`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const reveal = res.json() as Reveal;
    expect(reveal.status).toBe("voided");
    expect(reveal.broke_blind_at).not.toBeNull();
    expect(reveal.substance_name).toBe("Theanine");

    // The DB is voided with a permanent marker.
    const row = await ctx.db.query<{ status: string; broke_blind_at: string | null }>(
      `SELECT status, broke_blind_at FROM experiments WHERE id = $1`,
      [id]
    );
    expect(row[0].status).toBe("voided");
    expect(row[0].broke_blind_at).not.toBeNull();

    // The reveal equals the stored allocations, in block_index order.
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
    expect(reveal.blocks).toHaveLength(stored.length);
    reveal.blocks.forEach((b, i) => {
      expect(b.code).toBe(stored[i].code);
      expect(b.contents).toBe(stored[i].condition === "active" ? "Theanine" : "Blank");
      expect(b.block_start_date).toBe(stored[i].block_start_date);
      expect(b.block_end_date).toBe(stored[i].block_end_date);
    });
  });

  it("is idempotent and never moves broke_blind_at", async () => {
    const id = await lockAndRun(ctx, cookie);
    const first = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/break-blind`, headers: { cookie } });
    expect(first.statusCode).toBe(200);
    const firstAt = (first.json() as Reveal).broke_blind_at;

    const second = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/break-blind`, headers: { cookie } });
    expect(second.statusCode).toBe(200);
    const secondReveal = second.json() as Reveal;
    expect(secondReveal.broke_blind_at).toBe(firstAt);
    expect(secondReveal.status).toBe("voided");
    // Same reveal both times.
    expect(second.json()).toEqual(first.json());
  });

  it("refuses a finished (unblinded) or not-yet-started run", async () => {
    const unblinded = await lockAndRun(ctx, cookie);
    await ctx.db.query(`UPDATE experiments SET status = 'unblinded' WHERE id = $1`, [unblinded]);
    const u = await ctx.app.inject({ method: "POST", url: `/api/experiments/${unblinded}/break-blind`, headers: { cookie } });
    expect(u.statusCode).toBe(422);
    expect(u.json().error.message).toBe("This run has already finished.");

    const prepped = await lock(ctx, cookie);
    const p = await ctx.app.inject({ method: "POST", url: `/api/experiments/${prepped}/break-blind`, headers: { cookie } });
    expect(p.statusCode).toBe(422);
    expect(p.json().error.message).toBe("This run has not started.");
  });

  it("guards access: unauth 401, other user 404", async () => {
    const id = await lockAndRun(ctx, cookie);
    const unauth = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/break-blind` });
    expect(unauth.statusCode).toBe(401);

    const other = await signIn(ctx.app, "break-intruder@example.com");
    const cross = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/break-blind`, headers: { cookie: other } });
    expect(cross.statusCode).toBe(404);
  });

  it("does not weaken the seal: a frozen column still cannot change after voiding", async () => {
    const id = await lockAndRun(ctx, cookie);
    const res = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/break-blind`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    await expect(
      ctx.db.query(`UPDATE experiments SET metric_name = 'Changed' WHERE id = $1`, [id])
    ).rejects.toThrow();
  });
});
