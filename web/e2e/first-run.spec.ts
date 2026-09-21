import { expect, test } from "@playwright/test";
import { lockDesign, signIn, startRun } from "./helpers.js";

const STEPS = [
  "Pick a template or name what you are testing.",
  "Confirm this is a supplement, not a prescription drug.",
  "Lock your design to seal it.",
  "Prepare your capsules and start your run.",
];

test.describe("guided first run", () => {
  test("a brand-new user sees the four-step checklist and can skip it", async ({ page }) => {
    await signIn(page);
    await page.goto("/design");
    await expect(page.getByRole("heading", { name: "Design your blind test" })).toBeVisible();

    const walk = page.locator(".walk");
    await expect(walk).toBeVisible();
    for (const step of STEPS) {
      await expect(walk.getByText(step, { exact: true })).toBeVisible();
    }
    await expect(walk.getByRole("button", { name: "Skip" })).toBeVisible();

    // Skippable: pressing Skip hides it at once and it stays gone on reload.
    await walk.getByRole("button", { name: "Skip" }).click();
    await expect(page.locator(".walk")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Design your blind test" })).toBeVisible();
    await expect(page.locator(".walk")).toHaveCount(0);
  });

  test("the checklist survives locking and stays until a run starts", async ({ page }) => {
    // Lock a design, then return to /design: locking no longer ends the walk.
    await lockDesign(page);
    await page.goto("/design");
    await expect(page.locator(".walk")).toBeVisible();
    await expect(page.locator(".walk").getByText(STEPS[3], { exact: true })).toBeVisible();
  });

  test("the checklist clears the moment the first run starts and never returns", async ({ page }) => {
    // startRun locks and starts a real run through the full flow.
    await startRun(page);
    await page.goto("/design");
    await expect(page.getByRole("heading", { name: "Design your blind test" })).toBeVisible();
    await expect(page.locator(".walk")).toHaveCount(0);
  });
});
