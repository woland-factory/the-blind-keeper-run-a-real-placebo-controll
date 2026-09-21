import { expect, test } from "@playwright/test";
import { startRun } from "./helpers.js";

test.describe("accessibility basics", () => {
  test("the email input is labeled and the form is keyboard-operable", async ({ page }) => {
    await page.goto("/");

    // Labeled input: getByLabel resolves only when the label is associated.
    const email = page.getByLabel("Email");
    await expect(email).toBeVisible();

    // Keyboard reaches the input and the primary action.
    await email.focus();
    await expect(email).toBeFocused();
    await email.fill("keyboard@example.com");

    const button = page.getByRole("button", { name: "Send my sign-in link" });
    await button.focus();
    await expect(button).toBeFocused();

    // Enter on the focused primary control submits and advances the flow.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  });

  test("the run check-in labels every field and keeps the primary action keyboard-reachable", async ({ page }) => {
    const id = await startRun(page);
    await page.goto(`/experiments/${id}/run`);
    await expect(page.getByRole("heading", { name: "Today's check-in" })).toBeVisible();

    // Each check-in field is reachable by its label or group name.
    await expect(page.getByRole("group", { name: "Afternoon focus" })).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Your guess: was today the blank or the supplement?" })
    ).toBeVisible();
    await expect(page.getByLabel("Note (optional)")).toBeVisible();

    // Fill the check-in so the primary action is live, then prove it is
    // keyboard-focusable and exposes its busy state.
    await page.getByRole("button", { name: "More Afternoon focus" }).click();
    await page.getByRole("button", { name: "Not sure" }).click();
    const save = page.getByRole("button", { name: "Save check-in" });
    await expect(save).toBeEnabled();
    await save.focus();
    await expect(save).toBeFocused();
    await expect(save).toHaveAttribute("aria-busy", "false");
  });
});
