import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signIn, startRun } from "./helpers.js";

test.describe("personal formulary", () => {
  test("a brand-new user sees the empty state with the first-test action", async ({ page }) => {
    // signIn already asserts the preserved "Start your first blind test" heading.
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Start your first blind test" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Design a test" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("a finished run appears as a card that opens its verdict, with an export link", async ({ page }) => {
    const id = await startRun(page);
    expect((await page.request.post(`/api/experiments/${id}/complete-run`)).ok()).toBe(true);
    expect((await page.request.post(`/api/experiments/${id}/unblind`)).ok()).toBe(true);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your formulary" })).toBeVisible();

    // The export is a real same-origin link to the download route.
    const exportLink = page.getByRole("link", { name: "Export" });
    await expect(exportLink).toHaveAttribute("href", "/api/formulary/export");

    await expectNoHorizontalScroll(page);

    // The card carries the substance and opens the verdict when tapped.
    const card = page.getByRole("link", { name: /Theanine/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/experiments/${id}/verdict$`));
    await expect(page.getByRole("heading", { name: "Your verdict" })).toBeVisible();
  });

  test("a voided run appears marked voided and opens its summary", async ({ page }) => {
    const id = await startRun(page);
    expect((await page.request.post(`/api/experiments/${id}/break-blind`)).ok()).toBe(true);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your formulary" })).toBeVisible();
    await expect(page.getByText("Voided", { exact: true })).toBeVisible();

    const card = page.getByRole("link", { name: /Theanine/ });
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/experiments/${id}$`));
    await expect(page.getByText("This run is voided.", { exact: false })).toBeVisible();
  });

  test("the design screen names measured vs assumed day-to-day noise", async ({ page }) => {
    await signIn(page);
    await page.goto("/design");
    await expect(page.getByRole("heading", { name: "Design your blind test" })).toBeVisible();

    // No history for this metric: the real preview reports the assumed noise.
    await page.locator("#metric").fill("Afternoon focus");
    await expect(
      page.getByText("This uses a typical day-to-day noise. Finish a run of this metric to tune it to you.")
    ).toBeVisible();

    // The dev backfill carries no within-block spread, so a real measured run is
    // not reachable from the UI; force a measured preview to confirm the screen
    // sends the metric name and renders the measured line. The real measured
    // computation is covered by the server preview tests.
    await page.route("**/api/experiments/preview", async (route) => {
      const body = route.request().postData() ?? "";
      const measured = body.includes('"metric_name":"Afternoon focus"');
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          num_active_blocks: 3,
          num_blank_blocks: 3,
          run_length_days: 30,
          p_value_floor: 0.05,
          mde: measured ? 2.9 : 1.4,
          mde_units: "points",
          can_reach_significance: true,
          noise_source: measured ? "measured" : "assumed",
          safety: { blocked: false, matched_term: null },
        }),
      });
    });

    await page.locator("#metric").fill("");
    await page.locator("#metric").fill("Afternoon focus");
    await expect(
      page.getByText("This is tuned to the day-to-day noise measured in your past runs of this metric.")
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
