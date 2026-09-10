import { expect, test } from "@playwright/test";

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
});
