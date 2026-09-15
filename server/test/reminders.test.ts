import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, signIn, type TestApp } from "./helpers.js";
import { sendDailyReminders } from "../src/reminders.js";

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

const silentLog = { error: () => {} };

async function lockAndRun(ctx: TestApp, cookie: string): Promise<string> {
  const create = await ctx.app.inject({ method: "POST", url: "/api/experiments", headers: { cookie }, payload: validBody });
  const id = create.json().id as string;
  const confirm = await ctx.app.inject({ method: "POST", url: `/api/experiments/${id}/confirm-prep`, headers: { cookie } });
  expect(confirm.statusCode).toBe(200);
  return id;
}

describe("sendDailyReminders", () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.close();
  });

  it("emails only users with an open check-in, at most one per user per day", async () => {
    const emailA = "reminder-a@example.com";
    const emailB = "reminder-b@example.com";
    const emailC = "reminder-c@example.com";

    // User A: one running experiment, no check-in today.
    const cookieA = await signIn(ctx.app, emailA);
    await lockAndRun(ctx, cookieA);

    // User B: one running experiment, already checked in today.
    const cookieB = await signIn(ctx.app, emailB);
    const idB = await lockAndRun(ctx, cookieB);
    const checkin = await ctx.app.inject({
      method: "POST",
      url: `/api/experiments/${idB}/checkins`,
      headers: { cookie: cookieB },
      payload: { metric_value: 5, placebo_guess: "active" },
    });
    expect(checkin.statusCode).toBe(201);

    // User C: two running experiments, no check-in. Still at most one email.
    const cookieC = await signIn(ctx.app, emailC);
    await lockAndRun(ctx, cookieC);
    await lockAndRun(ctx, cookieC);

    const first = await sendDailyReminders(ctx.db, ctx.app.mailer, ctx.env.APP_BASE_URL, silentLog);
    expect(first.sent).toBe(2); // A and C, not B
    expect(ctx.app.mailer.reminderCountFor(emailA)).toBe(1);
    expect(ctx.app.mailer.reminderCountFor(emailB)).toBe(0);
    expect(ctx.app.mailer.reminderCountFor(emailC)).toBe(1);

    // A second sweep the same day sends nothing: the unique guard debounces.
    const second = await sendDailyReminders(ctx.db, ctx.app.mailer, ctx.env.APP_BASE_URL, silentLog);
    expect(second.sent).toBe(0);
    expect(ctx.app.mailer.reminderCountFor(emailA)).toBe(1);
    expect(ctx.app.mailer.reminderCountFor(emailC)).toBe(1);
  });
});
