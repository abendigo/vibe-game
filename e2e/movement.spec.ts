import { test, expect } from "@playwright/test";
import { joinGame, uniqueName } from "./helpers.js";

test.describe("Movement", () => {
  test("D key moves player right (positive x)", async ({ page }) => {
    const name = uniqueName("MoveRight");
    await joinGame(page, name);

    const before = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    expect(before).toBeTruthy();

    await page.keyboard.down("d");
    await page.waitForTimeout(400);
    await page.keyboard.up("d");
    await page.waitForTimeout(200);

    const after = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    expect(after.x).toBeGreaterThan(before.x);
  });

  test("W key moves player up (negative y)", async ({ page }) => {
    const name = uniqueName("MoveUp");
    await joinGame(page, name);

    const before = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );

    await page.keyboard.down("w");
    await page.waitForTimeout(400);
    await page.keyboard.up("w");
    await page.waitForTimeout(200);

    const after = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    expect(after.y).toBeLessThan(before.y);
  });

  test("no movement when no keys pressed", async ({ page }) => {
    const name = uniqueName("NoMove");
    await joinGame(page, name);

    const before = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );

    await page.waitForTimeout(500);

    const after = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});
