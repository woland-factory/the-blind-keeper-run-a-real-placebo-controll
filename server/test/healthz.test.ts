import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "./helpers.js";

describe("GET /api/healthz", () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("returns 200 ok when the DB is reachable", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("returns 503 degraded when the DB check fails", async () => {
    const original = ctx.db.healthcheck;
    ctx.db.healthcheck = async () => false;
    const res = await ctx.app.inject({ method: "GET", url: "/api/healthz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "degraded" });
    ctx.db.healthcheck = original;
  });
});
