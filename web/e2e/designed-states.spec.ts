import { expect, test } from "@playwright/test";

test.describe("designed states", () => {
  test("expired link renders a designed error with a next step", async ({ page }) => {
    await page.goto("/auth/expired");
    await expect(page.getByRole("heading", { name: "That link expired" })).toBeVisible();
    await expect(page.getByText("Sign-in links work once and last 15 minutes.")).toBeVisible();
    await page.getByRole("button", { name: "Send a new link" }).click();
    await expect(page.getByRole("heading", { name: "Run a real placebo test on yourself." })).toBeVisible();
  });

  test("loading holds the layout with a skeleton, not a blank screen", async ({ page }) => {
    // Delay /api/me so the loading state is observable.
    await page.route("**/api/me", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.goto("/");
    await expect(page.locator(".skeleton").first()).toBeVisible();
  });

  test("authenticated home renders the designed empty state", async ({ page }) => {
    const email = `states-user-${Date.now()}@example.com`;
    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    const res = await page.request.get(`/api/dev/last-magic-link?email=${encodeURIComponent(email)}`);
    const { link } = (await res.json()) as { link: string };
    const token = new URL(link).searchParams.get("token")!;
    await page.goto(`/api/auth/verify?token=${encodeURIComponent(token)}`);

    await expect(page.getByRole("heading", { name: "Start your first blind test" })).toBeVisible();
    await expect(
      page.getByText("We keep the schedule secret so you stay blind.", { exact: false })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Design a test" })).toBeVisible();
  });
});
