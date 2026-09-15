import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, extractSessionCookie, signIn, type TestApp } from "./helpers.js";
import { runSeed, DEMO_EMAIL } from "../src/seed.js";

// Guards the trust invariant for later epics: allocation rows (the secret
// code-to-condition map) must never appear in any API response this epic
// serves. If a future change leaks them, this test fails.
describe("allocations are never serialized to a client", () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
    await runSeed(ctx.db, { info: () => {} });
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("keeps allocation codes out of every response on the demo account", async () => {
    const codes = (
      await ctx.db.query<{ code: string }>(`SELECT code FROM allocations`)
    ).map((r) => r.code);
    expect(codes.length).toBeGreaterThan(0);

    // Sign in as the demo user and exercise the epic's authenticated surface.
    await ctx.app.inject({ method: "POST", url: "/api/auth/magic-link", payload: { email: DEMO_EMAIL } });
    const link = (
      await ctx.app.inject({ method: "GET", url: `/api/dev/last-magic-link?email=${encodeURIComponent(DEMO_EMAIL)}` })
    ).json().link as string;
    const token = new URL(link).searchParams.get("token")!;
    const verify = await ctx.app.inject({ method: "GET", url: `/api/auth/verify?token=${encodeURIComponent(token)}` });
    const cookie = extractSessionCookie(verify.headers["set-cookie"])!;

    const responses = [
      await ctx.app.inject({ method: "GET", url: "/api/healthz" }),
      await ctx.app.inject({ method: "GET", url: "/api/me", headers: { cookie } }),
      verify,
    ];

    for (const res of responses) {
      const body = res.body ?? "";
      for (const code of codes) {
        expect(body).not.toContain(code);
      }
      expect(body.toLowerCase()).not.toContain("placebo");
      expect(body).not.toContain("allocation");
    }
  });

  it("keeps the secret out of a freshly locked experiment's responses", async () => {
    const cookie = await signIn(ctx.app, "trust-user@example.com");
    const create = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: {
        substance_name: "Theanine",
        metric_name: "Afternoon focus",
        metric_type: "rating_0_10",
        metric_direction: "higher_better",
        block_length_days: 5,
        num_blocks: 6,
        washout_note: "Skip 1 day between blocks.",
        acknowledged: true,
      },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id as string;

    // The real codes just generated for this experiment.
    const codes = (
      await ctx.db.query<{ code: string }>(`SELECT code FROM allocations WHERE experiment_id = $1`, [id])
    ).map((r) => r.code);
    expect(codes).toHaveLength(6);

    const get = await ctx.app.inject({
      method: "GET",
      url: `/api/experiments/${id}`,
      headers: { cookie },
    });
    expect(get.statusCode).toBe(200);

    for (const res of [create, get]) {
      const body = res.body ?? "";
      for (const code of codes) expect(body).not.toContain(code);
      expect(body.toLowerCase()).not.toContain("placebo");
      expect(body).not.toContain("allocation");
      expect(body).not.toContain("condition");
    }

    // Another user cannot read it: a miss returns 404, never leaking existence.
    const otherCookie = await signIn(ctx.app, "other-user@example.com");
    const cross = await ctx.app.inject({
      method: "GET",
      url: `/api/experiments/${id}`,
      headers: { cookie: otherCookie },
    });
    expect(cross.statusCode).toBe(404);
  });

  it("keeps the secret out of a running experiment and its confirm-ready response", async () => {
    const cookie = await signIn(ctx.app, "running-trust@example.com");
    const create = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: {
        substance_name: "Theanine",
        metric_name: "Afternoon focus",
        metric_type: "rating_0_10",
        metric_direction: "higher_better",
        block_length_days: 5,
        num_blocks: 6,
        washout_note: "Skip 1 day between blocks.",
        acknowledged: true,
      },
    });
    const id = create.json().id as string;
    const codes = (
      await ctx.db.query<{ code: string }>(`SELECT code FROM allocations WHERE experiment_id = $1`, [id])
    ).map((r) => r.code);

    const confirm = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/confirm-prep`,
      headers: { cookie },
    });
    expect(confirm.statusCode).toBe(200);
    const get = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}`, headers: { cookie } });

    // The non-secret surfaces still carry no code, condition, or block date.
    // "active" is not checked here: the summary key num_active_blocks is a design
    // count, not a condition label (matching the freshly-locked assertion above).
    for (const res of [confirm, get]) {
      const body = res.body ?? "";
      for (const code of codes) expect(body).not.toContain(code);
      expect(body.toLowerCase()).not.toContain("placebo");
      expect(body).not.toContain("allocation");
      expect(body).not.toContain("condition");
      expect(body).not.toContain("block_start_date");
      expect(body).not.toContain("block_end_date");
    }

    // GET .../prep is the one intentional exception: it carries the codes (the
    // user needs them to label packets) but still no condition word, no
    // block_index, and no date. That is what keeps the code-to-day schedule
    // sealed.
    const prep = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/prep`, headers: { cookie } });
    expect(prep.statusCode).toBe(200);
    const prepBody = prep.body;
    // It does carry the codes.
    for (const code of codes) expect(prepBody).toContain(code);
    // It never carries a condition label, a block_index, or a date.
    expect(prepBody).not.toContain("active");
    expect(prepBody.toLowerCase()).not.toContain("placebo");
    expect(prepBody).not.toContain("condition");
    expect(prepBody).not.toContain("block_index");
    expect(prepBody).not.toContain("block_start_date");
    expect(prepBody).not.toContain("block_end_date");
  });

  it("keeps the schedule sealed on the running surfaces, revealing it only after break-blind", async () => {
    const cookie = await signIn(ctx.app, "run-trust@example.com");
    const create = await ctx.app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: { cookie },
      payload: {
        substance_name: "Theanine",
        metric_name: "Afternoon focus",
        metric_type: "rating_0_10",
        metric_direction: "higher_better",
        block_length_days: 5,
        num_blocks: 6,
        washout_note: "Skip 1 day between blocks.",
        acknowledged: true,
      },
    });
    const id = create.json().id as string;
    await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });

    const codes = (
      await ctx.db.query<{ code: string }>(`SELECT code FROM allocations WHERE experiment_id = $1`, [id])
    ).map((r) => r.code);

    // GET .../today reveals only today's single code, nothing else.
    const today = await ctx.app.inject({ method: "GET", url: `/api/experiments/${id}/today`, headers: { cookie } });
    const todayCode = today.json().today_code as string;
    const checkin = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${id}/checkins`,
      headers: { cookie },
      payload: { metric_value: 6, placebo_guess: "unsure" },
    });
    expect(checkin.statusCode).toBe(201);

    // Neither the today read nor the check-in response leaks the schedule.
    for (const res of [today, checkin]) {
      const body = res.body ?? "";
      for (const code of codes) {
        if (code === todayCode) continue;
        expect(body).not.toContain(code);
      }
      expect(body.toLowerCase()).not.toContain("placebo");
      expect(body).not.toContain("condition");
      expect(body).not.toContain("block_index");
      expect(body).not.toContain("block_start_date");
      expect(body).not.toContain("block_end_date");
    }

    // POST .../break-blind is the one intentional reveal, and only after voiding.
    const reveal = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/break-blind`, headers: { cookie } });
    expect(reveal.statusCode).toBe(200);
    const revealBody = reveal.json() as { status: string; blocks: Array<{ code: string; contents: string }> };
    expect(revealBody.status).toBe("voided");
    for (const code of codes) expect(reveal.body).toContain(code);
  });
});
