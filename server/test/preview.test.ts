import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, signIn, type TestApp } from "./helpers.js";

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
});
