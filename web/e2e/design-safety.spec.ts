import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.js";

test.describe("design safety gate", () => {
  test("a prescription drug disables Lock with a plain explanation", async ({ page }) => {
    await signIn(page);
    await page.goto("/design");

    // The not-medical-advice line is visible throughout.
    const safetyLine = page.getByText(
      "Supplements and behavior only, not prescription drugs.",
      { exact: false }
    );
    await expect(safetyLine).toBeVisible();

    await page.locator("#substance").fill("Adderall");
    await page.locator("#metric").fill("Afternoon focus");
    await page.getByRole("checkbox").check();

    // The block explanation appears near the substance field.
    await expect(
      page.getByText("looks like a prescription drug", { exact: false })
    ).toBeVisible();

    // Even with the box checked and a metric named, Lock stays disabled.
    await expect(page.getByRole("button", { name: "Lock and pre-register" })).toBeDisabled();
    await expect(safetyLine).toBeVisible();
  });
});
