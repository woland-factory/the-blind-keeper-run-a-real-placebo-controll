import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, startRun } from "./helpers.js";

// The whole suite runs at the 390px mobile viewport (see playwright.config.ts).
// This spec walks the authed run-loop screens and asserts none of them scroll
// sideways at that width.
test.describe("mobile at 390px: run-loop screens", () => {
  test("locked, prep, run, and verdict all fit the 390px viewport", async ({ page }) => {
    const id = await startRun(page);

    // Locked summary.
    await page.goto(`/experiments/${id}`);
    await expect(page.getByRole("heading", { name: "Your design is sealed" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Prep, re-opened after the run started.
    await page.goto(`/experiments/${id}/prep`);
    await expect(page.getByRole("heading", { name: "Your run is already going" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Running dashboard.
    await page.goto(`/experiments/${id}/run`);
    await expect(page.getByRole("heading", { name: "Today's check-in" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Reach the verdict without a multi-week wait (console-transport dev route).
    const complete = await page.request.post(`/api/experiments/${id}/complete-run`);
    expect(complete.ok()).toBe(true);
    const unblind = await page.request.post(`/api/experiments/${id}/unblind`);
    expect(unblind.ok()).toBe(true);

    await page.goto(`/experiments/${id}/verdict`);
    await expect(page.getByRole("heading", { name: "Your verdict" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
