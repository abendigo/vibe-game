import { test, expect } from "@playwright/test";
import { joinGame, uniqueName } from "./helpers.js";

test.describe("Movement", () => {
  test("W key increases speed and moves player (heading 0 = east)", async ({ page }) => {
    const name = uniqueName("MoveW");
    await joinGame(page, name);

    const before = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    expect(before).toBeTruthy();

    // W increases speed — initial heading is 0 (east), so player moves in +x
    await page.keyboard.press("w");
    await page.waitForTimeout(600);

    const after = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    expect(after.x).toBeGreaterThan(before.x);
  });

  test("steering with A/D changes heading over time", async ({ page }) => {
    const name = uniqueName("Steer");
    await joinGame(page, name);

    const before = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    expect(before).toBeTruthy();

    // Press W to set speed, then D to steer right — player should move
    await page.keyboard.press("w");
    await page.keyboard.press("d");
    await page.waitForTimeout(600);

    const after = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    // With speed 1 and right steering, player moves (mostly east + slightly south)
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
  });

  test("no movement when no keys pressed", async ({ page }) => {
    const name = uniqueName("NoMove");
    await joinGame(page, name);

    const before = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    expect(before).toBeTruthy();

    await page.waitForTimeout(500);

    const after = await page.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});
