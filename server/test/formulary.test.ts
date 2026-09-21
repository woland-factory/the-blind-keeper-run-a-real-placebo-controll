import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, signIn, type TestApp } from "./helpers.js";

const baseBody = {
  metric_name: "Afternoon focus",
  metric_type: "rating_0_10",
  metric_direction: "higher_better",
  block_length_days: 5,
  num_blocks: 6,
  washout_note: "Skip 1 day between blocks.",
  acknowledged: true,
};

async function lockAndStart(ctx: TestApp, cookie: string, substance: string): Promise<string> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/experiments",
    headers: { cookie },
    payload: { ...baseBody, substance_name: substance },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  const confirm = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });
  expect(confirm.statusCode).toBe(200);
  return id;
}

async function finishUnblinded(ctx: TestApp, cookie: string, substance: string): Promise<string> {
  const id = await lockAndStart(ctx, cookie, substance);
  await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/complete-run`, headers: { cookie } });
  const unblind = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/unblind`, headers: { cookie } });
  expect(unblind.statusCode).toBe(200);
  return id;
}

async function finishVoided(ctx: TestApp, cookie: string, substance: string): Promise<string> {
  const id = await lockAndStart(ctx, cookie, substance);
  const reveal = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/break-blind`, headers: { cookie } });
  expect(reveal.statusCode).toBe(200);
  return id;
}

async function codesOf(ctx: TestApp, id: string): Promise<string[]> {
  return (
    await ctx.db.query<{ code: string }>(`SELECT code FROM allocations WHERE experiment_id = $1`, [id])
  ).map((r) => r.code);
}

describe("formulary list and export", () => {
  let ctx: TestApp;
  let cookie: string;
  let unblindedId: string;
  let voidedId: string;
  let runningId: string;

  beforeAll(async () => {
    ctx = await buildTestApp({ RATE_LIMIT_MAX: "10000", MUTATION_RATE_LIMIT_MAX: "1000" });
    cookie = await signIn(ctx.app, "formulary-owner@example.com");
    // Finish the unblinded run first, then the voided one, so the voided run is
    // the newest by its break-blind time. Leave a third run sealed and running.
    unblindedId = await finishUnblinded(ctx, cookie, "Theanine");
    voidedId = await finishVoided(ctx, cookie, "Magnesium glycinate");
    runningId = await lockAndStart(ctx, cookie, "Creatine");
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("lists finished runs newest first, repeating the stored verdict without re-judging", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/formulary", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const cards = res.json().cards as Array<{
      id: string;
      status: string;
      substance_name: string;
      metric_name: string;
      run_length_days: number;
      ended_on: string | null;
      verdict: {
        significant: boolean;
        guesses_beat_chance: boolean;
        permutation_p_value: number | null;
        guess_days_correct: number;
        guess_days_scored: number;
        adherence_pct: number | null;
      } | null;
    }>;

    // Only the two finished runs, newest first (voided finished last).
    expect(cards.map((c) => c.id)).toEqual([voidedId, unblindedId]);
    expect(cards.some((c) => c.id === runningId)).toBe(false);

    const voided = cards[0];
    expect(voided.status).toBe("voided");
    expect(voided.substance_name).toBe("Magnesium glycinate");
    expect(voided.verdict).toBeNull();

    const unblinded = cards[1];
    expect(unblinded.status).toBe("unblinded");
    expect(unblinded.run_length_days).toBe(30);
    expect(unblinded.verdict).not.toBeNull();

    // The card repeats the stored verdict to the digit; it never re-judges.
    const verdictRes = await ctx.app.inject({ method: "GET", url: `/api/experiments/${unblindedId}/verdict`, headers: { cookie } });
    const v = verdictRes.json().verdict;
    expect(unblinded.verdict!.significant).toBe(v.significant);
    expect(unblinded.verdict!.guesses_beat_chance).toBe(v.guesses_beat_chance);
    expect(unblinded.verdict!.permutation_p_value).toBe(v.permutation_p_value);
    expect(unblinded.verdict!.guess_days_correct).toBe(v.guess_days_correct);
    expect(unblinded.verdict!.guess_days_scored).toBe(v.guess_days_scored);
    expect(unblinded.verdict!.adherence_pct).toBe(v.adherence_pct);
  });

  it("exports finished runs in full with the attachment headers", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/formulary/export", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="blind-keeper-export.json"');
    expect(String(res.headers["content-type"])).toContain("application/json");

    const body = res.json() as {
      schema_version: number;
      exported_for: string;
      runs: Array<{
        id: string;
        status: string;
        verdict: { verdict_text: string } | null;
        schedule: Array<{ code: string; contents: string }>;
        check_ins: Array<{ check_date: string; metric_value: number | null }>;
      }>;
    };

    expect(body.schema_version).toBe(1);
    expect(body.exported_for).toBe("formulary-owner@example.com");
    expect(body.runs.map((r) => r.id).sort()).toEqual([unblindedId, voidedId].sort());

    const unblinded = body.runs.find((r) => r.id === unblindedId)!;
    expect(unblinded.verdict).not.toBeNull();
    expect(typeof unblinded.verdict!.verdict_text).toBe("string");
    expect(unblinded.schedule.some((b) => b.contents === "Blank")).toBe(true);
    expect(unblinded.check_ins.length).toBe(30);

    const voided = body.runs.find((r) => r.id === voidedId)!;
    expect(voided.verdict).toBeNull();

    // The sealed running run and any of its allocation codes never appear.
    expect(body.runs.some((r) => r.id === runningId)).toBe(false);
    const runningCodes = await codesOf(ctx, runningId);
    for (const code of runningCodes) expect(res.body).not.toContain(code);
  });

  it("isolates each user: neither list nor export reaches another user's data", async () => {
    const other = await signIn(ctx.app, "formulary-intruder@example.com");
    const otherId = await finishUnblinded(ctx, other, "Ashwagandha");

    const otherList = await ctx.app.inject({ method: "GET", url: "/api/formulary", headers: { cookie: other } });
    const otherCards = otherList.json().cards as Array<{ id: string; substance_name: string }>;
    expect(otherCards.map((c) => c.id)).toEqual([otherId]);
    expect(otherCards.some((c) => c.substance_name === "Theanine")).toBe(false);

    // The owner's surfaces never carry the intruder's run.
    const ownerList = await ctx.app.inject({ method: "GET", url: "/api/formulary", headers: { cookie } });
    expect(ownerList.body).not.toContain(otherId);
    expect(ownerList.body).not.toContain("Ashwagandha");

    const ownerExport = await ctx.app.inject({ method: "GET", url: "/api/formulary/export", headers: { cookie } });
    expect(ownerExport.body).not.toContain(otherId);
    expect(ownerExport.body).not.toContain("Ashwagandha");
    expect(ownerExport.body).not.toContain("formulary-intruder@example.com");

    // And the intruder's export never carries the owner's runs or check-ins.
    const otherExport = await ctx.app.inject({ method: "GET", url: "/api/formulary/export", headers: { cookie: other } });
    expect(otherExport.body).not.toContain(unblindedId);
    expect(otherExport.body).not.toContain(voidedId);
    expect(otherExport.body).not.toContain("Theanine");
    const ownerCodes = await codesOf(ctx, unblindedId);
    for (const code of ownerCodes) expect(otherExport.body).not.toContain(code);
  });

  it("requires authentication on both routes", async () => {
    const list = await ctx.app.inject({ method: "GET", url: "/api/formulary" });
    expect(list.statusCode).toBe(401);
    const exp = await ctx.app.inject({ method: "GET", url: "/api/formulary/export" });
    expect(exp.statusCode).toBe(401);
  });
});
