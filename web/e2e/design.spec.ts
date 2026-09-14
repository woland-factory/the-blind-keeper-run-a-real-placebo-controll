import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signIn } from "./helpers.js";

test.describe("design and lock", () => {
  test("prefills from a template, shows the power statement, and locks", async ({ page }) => {
    await signIn(page);
    await page.goto("/design");

    await expect(page.getByRole("heading", { name: "Design your blind test" })).toBeVisible();
    await expect(
      page.getByText("Supplements and behavior only, not prescription drugs.", { exact: false })
    ).toBeVisible();

    // A template chip prefills the form.
    await page.getByRole("button", { name: "Magnesium glycinate" }).click();
    await expect(page.locator("#substance")).toHaveValue("Magnesium glycinate");
    await expect(page.locator("#metric")).toHaveValue("Sleep quality");

    // The live power statement names an MDE and a p-value floor.
    await expect(page.getByText("you can spot a change of about", { exact: false })).toBeVisible();
    await expect(
      page.getByText("The best p-value this design can reach is", { exact: false })
    ).toBeVisible();

    // Lock is disabled until the acknowledgement is checked.
    const lock = page.getByRole("button", { name: "Lock and pre-register" });
    await expect(lock).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(lock).toBeEnabled();

    // Exactly one primary action on the screen.
    await expect(page.locator(".btn-primary")).toHaveCount(1);
    await expectNoHorizontalScroll(page);

    await lock.click();

    // Lands on the locked summary.
    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Locked", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your design is sealed" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare your capsules" })).toBeVisible();

    // The forward button routes to the real prep walkthrough, not a dead end.
    await page.getByRole("button", { name: "Prepare your capsules" }).click();
    await expect(page.getByRole("heading", { name: "Prepare your capsules" })).toBeVisible();
    await expect(page.getByText("Step 1 of", { exact: false })).toBeVisible();

    // Refreshing the locked summary re-fetches and renders.
    await page.goBack();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your design is sealed" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
