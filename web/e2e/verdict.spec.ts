import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, startRun } from "./helpers.js";

test.describe("unblinding verdict", () => {
  test("the signature moment: complete the run, reveal, and read the two-part verdict", async ({ page }) => {
    const id = await startRun(page);

    // Reach a complete run without a 42-day wait (console-transport dev route).
    const complete = await page.request.post(`/api/experiments/${id}/complete-run`);
    expect(complete.ok()).toBe(true);

    await page.goto(`/experiments/${id}/run`);
    await expect(page.getByRole("heading", { name: "Your run is complete" })).toBeVisible();
    const reveal = page.getByRole("button", { name: "Reveal the verdict" });
    await expect(reveal).toBeVisible();
    await reveal.click();

    await expect(page).toHaveURL(new RegExp(`/experiments/${id}/verdict$`));
    await expect(page.getByRole("heading", { name: "Your verdict" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What the data says" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Could you feel it?" })).toBeVisible();
    // The 2.7 backfill guesses every day correctly, so this branch is guaranteed.
    await expect(page.getByText("You felt it.", { exact: false })).toBeVisible();
    await expect(page.getByText("You logged", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How much this run could see" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The schedule, unsealed" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Blank" }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("the verdict persists and the summary links to it", async ({ page }) => {
    const id = await startRun(page);
    await page.request.post(`/api/experiments/${id}/complete-run`);

    // Reveal once via the API, then load the verdict URL directly.
    await page.goto(`/experiments/${id}/run`);
    await page.getByRole("button", { name: "Reveal the verdict" }).click();
    await expect(page).toHaveURL(new RegExp(`/experiments/${id}/verdict$`));

    await page.goto(`/experiments/${id}/verdict`);
    await expect(page.getByRole("heading", { name: "Your verdict" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What the data says" })).toBeVisible();

    // The locked summary reads as finished and links back to the verdict.
    await page.goto(`/experiments/${id}`);
    await expect(page.getByText("This run is finished.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "See the verdict" }).click();
    await expect(page).toHaveURL(new RegExp(`/experiments/${id}/verdict$`));
    await expect(page.getByRole("heading", { name: "Your verdict" })).toBeVisible();
  });

  test("a sealed run redirects away from the verdict URL instead of erroring", async ({ page }) => {
    const id = await startRun(page); // running, still inside its window

    await page.goto(`/experiments/${id}/verdict`);
    // The sealed 422 sends the user back to the summary, no broken page.
    await expect(page).toHaveURL(new RegExp(`/experiments/${id}$`));
    await expect(page.getByRole("heading", { name: "Your design is sealed" })).toBeVisible();
  });
});
