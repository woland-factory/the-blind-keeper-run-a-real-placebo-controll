import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, extractSessionCookie, type TestApp } from "./helpers.js";
import { hashToken } from "../src/auth.js";

function tokenFromLink(link: string): string {
  return new URL(link).searchParams.get("token")!;
}

describe("magic-link auth flow", () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("returns 200 for both known and unknown emails (no enumeration)", async () => {
    const a = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "known@example.com" },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual({ ok: true });

    const b = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "nobody-else@example.com" },
    });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual({ ok: true });
  });

  it("completes verify -> session -> me, and 401 without a session", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "flow@example.com" },
    });
    const linkRes = await ctx.app.inject({
      method: "GET",
      url: "/api/dev/last-magic-link?email=flow@example.com",
    });
    expect(linkRes.statusCode).toBe(200);
    const token = tokenFromLink(linkRes.json().link);

    const verify = await ctx.app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${encodeURIComponent(token)}`,
    });
    expect(verify.statusCode).toBe(302);
    expect(verify.headers.location).toBe("/");
    const cookie = extractSessionCookie(verify.headers["set-cookie"]);
    expect(cookie).toBeDefined();

    const meNoAuth = await ctx.app.inject({ method: "GET", url: "/api/me" });
    expect(meNoAuth.statusCode).toBe(401);

    const meAuth = await ctx.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookie! },
    });
    expect(meAuth.statusCode).toBe(200);
    expect(meAuth.json()).toEqual({ email: "flow@example.com" });

    // Second use of the same token must fail (single-use).
    const reuse = await ctx.app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${encodeURIComponent(token)}`,
    });
    expect(reuse.statusCode).toBe(302);
    expect(reuse.headers.location).toBe("/auth/expired");
  });

  it("rejects an expired token", async () => {
    const raw = "expired-raw-token-value";
    const user = await ctx.db.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      ["expired@example.com"]
    );
    await ctx.db.query(
      `INSERT INTO magic_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() - interval '1 hour')`,
      [user[0].id, hashToken(raw)]
    );
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${encodeURIComponent(raw)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/auth/expired");
  });

  it("logs out and clears the session", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "logout@example.com" },
    });
    const link = (
      await ctx.app.inject({ method: "GET", url: "/api/dev/last-magic-link?email=logout@example.com" })
    ).json().link;
    const verify = await ctx.app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${encodeURIComponent(tokenFromLink(link))}`,
    });
    const cookie = extractSessionCookie(verify.headers["set-cookie"])!;

    const logout = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);

    const me = await ctx.app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});
