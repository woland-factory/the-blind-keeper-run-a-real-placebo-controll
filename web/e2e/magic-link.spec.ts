import { expect, test } from "@playwright/test";

test.describe("magic-link sign-in", () => {
  test("completes end to end through the UI and signs out", async ({ page }) => {
    const email = `e2e-user-${Date.now()}@example.com`;

    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my sign-in link" }).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    // The console transport exposes the last link for the e2e suite.
    const res = await page.request.get(`/api/dev/last-magic-link?email=${encodeURIComponent(email)}`);
    expect(res.ok()).toBeTruthy();
    const { link } = (await res.json()) as { link: string };
    const token = new URL(link).searchParams.get("token")!;

    await page.goto(`/api/auth/verify?token=${encodeURIComponent(token)}`);

    // Landed on the authenticated home.
    await expect(page.getByRole("heading", { name: "Start your first blind test" })).toBeVisible();
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();

    // Back to the landing form.
    await expect(page.getByRole("heading", { name: "Run a real placebo test on yourself." })).toBeVisible();
  });
});
