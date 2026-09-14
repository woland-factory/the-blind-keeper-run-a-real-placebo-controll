import { expect, test } from "@playwright/test";
import { lockDesign } from "./helpers.js";

test.describe("prep sheet is blind-safe", () => {
  test("the printable sheet lists codes and batches but never the allocation", async ({ page }) => {
    await lockDesign(page, "Theanine");
    await page.getByRole("button", { name: "Prepare your capsules" }).click();
    await expect(page.getByRole("heading", { name: "Prepare your capsules" })).toBeVisible();

    // Under print media the walkthrough hides and only the sheet shows.
    await page.emulateMedia({ media: "print" });
    const sheet = page.locator(".prep-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.locator(".prep-live")).toBeHidden();

    // It lists every code with a batch token and a capsule count.
    await expect(sheet.locator("tbody tr")).toHaveCount(6);
    await expect(sheet).toContainText("Batch 1");
    await expect(sheet).toContainText("Batch 2");
    await expect(sheet).toContainText("This sheet hides which batch is which, so you stay blind.");

    // It never reveals the substance, a condition word, or a date.
    const sheetText = ((await sheet.textContent()) ?? "").toLowerCase();
    expect(sheetText).not.toContain("theanine");
    expect(sheetText).not.toContain("active");
    expect(sheetText).not.toContain("placebo");
    expect(sheetText).not.toContain("blank");
    expect(sheetText).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
