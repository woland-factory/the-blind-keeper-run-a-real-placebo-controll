import { expect, test } from "@playwright/test";

test.describe("landing", () => {
  test("shows real content and one primary action at 390px", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Run a real placebo test on yourself." })).toBeVisible();
    await expect(
      page.getByText("Pick a supplement. Stay blind for a few weeks.", { exact: false })
    ).toBeVisible();

    // Exactly one primary action on the screen.
    await expect(page.locator(".btn-primary")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Send my sign-in link" })).toBeVisible();

    // No horizontal scroll at the 390px baseline.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    );
    expect(overflow).toBe(true);
  });
});
