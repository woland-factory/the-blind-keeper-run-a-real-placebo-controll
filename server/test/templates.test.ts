import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, signIn, type TestApp } from "./helpers.js";
import { METRIC_TYPES, METRIC_DIRECTIONS } from "../src/metrics.js";

describe("GET /api/experiments/templates", () => {
  let ctx: TestApp;
  let cookie: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
    cookie = await signIn(ctx.app, "templates@example.com");
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("requires authentication", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/experiments/templates" });
    expect(res.statusCode).toBe(401);
  });

  it("returns at least four valid templates and no secret fields", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/experiments/templates",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { templates } = res.json() as { templates: Array<Record<string, unknown>> };
    expect(templates.length).toBeGreaterThanOrEqual(4);

    for (const t of templates) {
      expect(METRIC_TYPES).toContain(t.metric_type);
      expect(METRIC_DIRECTIONS).toContain(t.metric_direction);
      expect(t.block_length_days as number).toBeGreaterThanOrEqual(3);
      expect(t.block_length_days as number).toBeLessThanOrEqual(14);
      expect(t.num_blocks as number).toBeGreaterThanOrEqual(6);
      expect((t.num_blocks as number) % 2).toBe(0);
      expect(typeof t.washout_note).toBe("string");
      expect((t.washout_note as string).length).toBeGreaterThan(0);
      // The internal power input never leaves the server.
      expect(t.assumed_within_sd).toBeUndefined();
    }
  });
});
