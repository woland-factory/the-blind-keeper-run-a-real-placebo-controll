import { expect, type Page } from "@playwright/test";

let counter = 0;

/** Sign a fresh user in through the real magic-link flow (console transport). */
export async function signIn(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${counter++}@example.com`;
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send my sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const res = await page.request.get(`/api/dev/last-magic-link?email=${encodeURIComponent(email)}`);
  const { link } = (await res.json()) as { link: string };
  const token = new URL(link).searchParams.get("token")!;
  await page.goto(`/api/auth/verify?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: "Start your first blind test" })).toBeVisible();
  return email;
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const ok = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  );
  expect(ok).toBe(true);
}

/**
 * Sign in, design a real experiment through the /design flow, and lock it.
 * Returns the new experiment id from the locked-summary URL.
 */
export async function lockDesign(page: Page, substance = "Theanine"): Promise<string> {
  await signIn(page);
  await page.goto("/design");
  await expect(page.getByRole("heading", { name: "Design your blind test" })).toBeVisible();
  await page.locator("#substance").fill(substance);
  await page.locator("#metric").fill("Afternoon focus");
  await page.getByRole("checkbox").check();
  const lock = page.getByRole("button", { name: "Lock and pre-register" });
  await expect(lock).toBeEnabled();
  await lock.click();
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}$/);
  const url = new URL(page.url());
  return url.pathname.split("/")[2];
}
