import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, startRun } from "./helpers.js";

test.describe("running dashboard", () => {
  test("shows today's code and completes a blind-safe check-in", async ({ page }) => {
    const id = await startRun(page);

    await page.goto(`/experiments/${id}/run`);

    // Today's code hero card.
    await expect(page.getByText("Open packet", { exact: false })).toBeVisible();
    const codeText = (await page.locator(".today-code-value").textContent()) ?? "";
    expect(codeText).toMatch(/^[A-Z0-9]{3}$/);

    // Progress row.
    await expect(page.getByText(/\d+ sealed days?/)).toBeVisible();
    await expect(page.getByText(/\d+ days? left/)).toBeVisible();

    // The check-in form is present.
    await expect(page.getByRole("heading", { name: "Today's check-in" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // No condition word and no date-shaped string leak before any reveal.
    const pageText = (await page.locator("body").textContent()) ?? "";
    expect(pageText.toLowerCase()).not.toContain("placebo");
    expect(pageText).not.toMatch(/\bactive\b/i);
    expect(pageText).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    // Set the rating, pick a guess, and save.
    await page.getByRole("button", { name: "More Afternoon focus" }).click();
    await page.getByRole("button", { name: "Not sure" }).click();
    const save = page.getByRole("button", { name: "Save check-in" });
    await expect(save).toBeEnabled();
    await save.click();

    // The done state replaces the form with no reload.
    await expect(page.getByRole("heading", { name: "Checked in for today" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save check-in" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // The done state persists across a reload (server check_in_done).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Checked in for today" })).toBeVisible();
  });

  test("break-blind reveals the schedule and voids the run", async ({ page }) => {
    const id = await startRun(page);
    await page.goto(`/experiments/${id}/run`);

    // The subordinate control opens an inline confirm, it does not fire at once.
    await page.getByRole("button", { name: "Break the blind" }).click();
    await expect(page.getByText("Breaking the blind reveals the schedule", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Reveal and void" }).click();

    // The reveal shows the schedule and the voided state.
    await expect(page.getByRole("heading", { name: "Your run is voided" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Packet" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "What it was" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // The locked summary now reads as voided.
    await page.goto(`/experiments/${id}`);
    await expect(page.getByText("This run is voided.", { exact: false })).toBeVisible();
  });
});
