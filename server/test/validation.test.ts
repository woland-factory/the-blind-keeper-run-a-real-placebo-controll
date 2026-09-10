import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type Db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { loadEnv } from "../src/env.js";
import { buildTestApp, type TestApp } from "./helpers.js";

describe("boundary validation", () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("rejects a malformed magic-link body with 400 and a plain envelope", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("invalid_input");
    expect(typeof body.error.message).toBe("string");
    // No stack trace or zod dump leaks to the client.
    expect(JSON.stringify(body)).not.toMatch(/at |ZodError|\.ts:/);
  });

  it("rejects a missing body with 400", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_input");
  });
});

describe("production error handler", () => {
  let db: Db;

  afterAll(async () => {
    await db.close();
  });

  it("maps an unexpected throw to the generic envelope with no stack", async () => {
    db = await createDb({ driver: "pglite" });
    await runMigrations(db);
    const env = loadEnv({
      NODE_ENV: "production",
      DB_DRIVER: "pglite",
      MAIL_TRANSPORT: "console",
      APP_BASE_URL: "https://example.com",
      SESSION_COOKIE_SECRET: "prod-secret-that-is-long-enough-to-pass-min",
    });
    const app = await buildApp({ db, env });
    await app.ready();

    // Force the handler to throw after the boundary passes.
    db.query = async () => {
      throw new Error("secret internal detail");
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "ok@example.com" },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body).toEqual({
      error: { code: "internal", message: "The request failed on our side. Try again in a moment." },
    });
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
    await app.close();
  });
});
