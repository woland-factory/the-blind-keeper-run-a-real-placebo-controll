import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "./helpers.js";

describe("auth rate limiting", () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp({ AUTH_RATE_LIMIT_MAX: "3" });
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("returns 429 with the standard envelope after the burst", async () => {
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 5; i++) {
      last = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/magic-link",
        payload: { email: "burst@example.com" },
      });
      statuses.push(last.statusCode);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[4]).toBe(429);
    expect(last!.json()).toEqual({
      error: { code: "rate_limited", message: expect.any(String) },
    });
  });
});
