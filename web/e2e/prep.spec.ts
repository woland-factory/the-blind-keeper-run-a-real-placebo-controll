import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, lockDesign } from "./helpers.js";

test.describe("prep walkthrough", () => {
  test("walks a first-time user from a locked design to a running run", async ({ page }) => {
    const id = await lockDesign(page);

    // Enter prep from the locked summary.
    await page.getByRole("button", { name: "Prepare your capsules" }).click();
    await expect(page.getByRole("heading", { name: "Prepare your capsules" })).toBeVisible();
    await expect(page.getByText("Step 1 of", { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Step 1: make the capsules.
    await expect(page.locator(".prep-step-text")).toContainText("look the same");

    // Step 2: the one-time batch-to-contents link.
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(".prep-step-text")).toContainText("Batch 1");
    await expect(page.locator(".prep-step-text")).toContainText("Batch 2");

    // Step 3: a per-packet step shows a code and a neutral batch token, never a
    // condition word or a date.
    await page.getByRole("button", { name: "Next" }).click();
    const packet = page.locator(".prep-step-text");
    await expect(packet).toHaveText(
      /Put \d+ capsules from Batch [12] into a packet, seal it, and write [A-Z0-9]{3} on it\./
    );
    const packetText = (await packet.textContent()) ?? "";
    expect(packetText.toLowerCase()).not.toContain("active");
    expect(packetText.toLowerCase()).not.toContain("placebo");
    expect(packetText).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    await expectNoHorizontalScroll(page);

    // Step through the rest using only Next until the confirm step.
    for (let i = 0; i < 30; i++) {
      const next = page.getByRole("button", { name: "Next" });
      if (!(await next.isVisible())) break;
      await next.click();
    }

    // The confirm step offers the single primary action.
    const start = page.getByRole("button", { name: "Start the run" });
    await expect(start).toBeVisible();
    await expect(page.getByText("Step 10 of 10")).toBeVisible();
    await start.click();

    // Lands on the confirmation state.
    await expect(page.getByRole("heading", { name: "Your run starts today" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Returning to the summary shows the running line, not a second prep button.
    await page.goto(`/experiments/${id}`);
    await expect(page.getByText("Run in progress.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare your capsules" })).toHaveCount(0);

    // Re-opening prep after the run started does not re-enter the walkthrough.
    await page.goto(`/experiments/${id}/prep`);
    await expect(page.getByRole("heading", { name: "Your run is already going" })).toBeVisible();
  });
});
