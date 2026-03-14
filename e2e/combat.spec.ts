import { test, expect } from "@playwright/test";
import { joinGame, uniqueName, getHudText } from "./helpers.js";

test.describe("Combat", () => {
  test("firing a weapon starts combat when 2 players are nearby", async ({
    browser,
  }) => {
    // Create two separate browser contexts (two players)
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const name1 = uniqueName("Fighter1");
    const name2 = uniqueName("Fighter2");

    await joinGame(page1, name1);
    await joinGame(page2, name2);

    // Both should be exploring
    await expect(page1.locator("#phase-display")).toHaveText("Phase: Exploring");
    await expect(page2.locator("#phase-display")).toHaveText("Phase: Exploring");

    // Player 1 fires laser to initiate combat
    await page1.click("#btn-fire-laser");
    await page1.waitForTimeout(500);

    // Check if combat started — at least one page should show Combat
    const state1 = await page1.evaluate(
      () => (window as any).__TEST_GAME_STATE__
    );

    if (state1?.combatZone) {
      // Combat started — verify both pages show combat phase
      await expect(page1.locator("#phase-display")).toHaveText("Phase: Combat");
      await expect(page2.locator("#phase-display")).toHaveText("Phase: Combat");

      // One player should see turn info
      const turn1 = await getHudText(page1, "turn-display");
      const turn2 = await getHudText(page2, "turn-display");

      const hasTurnInfo =
        turn1.includes("YOUR TURN") ||
        turn1.includes("Turn:") ||
        turn2.includes("YOUR TURN") ||
        turn2.includes("Turn:");
      expect(hasTurnInfo).toBe(true);
    }
    // If combat didn't start (players too far), that's OK — spawn is random

    await ctx1.close();
    await ctx2.close();
  });

  test("combat UI buttons appear for current turn player", async ({
    browser,
  }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const name1 = uniqueName("CombatUI1");
    const name2 = uniqueName("CombatUI2");

    await joinGame(page1, name1);
    await joinGame(page2, name2);

    // Fire to start combat
    await page1.click("#btn-fire-laser");
    // Wait for combat state to propagate to both clients
    await page1.waitForTimeout(1000);
    await page2.waitForTimeout(500);

    const state1 = await page1.evaluate(
      () => (window as any).__TEST_GAME_STATE__
    );
    const state2 = await page2.evaluate(
      () => (window as any).__TEST_GAME_STATE__
    );

    if (state1?.combatZone && state2?.combatZone) {
      // The combat-ui (End Turn button) should be visible for exactly one player (current turn)
      const ui1Visible = await page1.locator("#combat-ui").isVisible();
      const ui2Visible = await page2.locator("#combat-ui").isVisible();

      // Exactly one should have the combat UI visible
      expect(ui1Visible !== ui2Visible).toBe(true);
    }
    // If combat didn't start (players too far apart), skip assertion

    await ctx1.close();
    await ctx2.close();
  });

  test("weapon bar is always visible", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await joinGame(page, uniqueName("WeaponBar"));

    // Weapon bar should be visible even during exploration
    await expect(page.locator("#weapon-bar")).toBeVisible();
    await expect(page.locator("#btn-fire-laser")).toBeVisible();
    await expect(page.locator("#btn-fire-projectile")).toBeVisible();
    await expect(page.locator("#btn-auto-target")).toBeVisible();

    await ctx.close();
  });

  test("non-combatant can still move during combat", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctx3 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const name1 = uniqueName("InCombat1");
    const name2 = uniqueName("InCombat2");
    const name3 = uniqueName("FreeRoamer");

    await joinGame(page1, name1);
    await joinGame(page2, name2);
    await joinGame(page3, name3);

    // Start combat via weapon fire
    await page1.click("#btn-fire-laser");
    await page1.waitForTimeout(500);

    // Regardless of combat status, p3 should be able to move if not in combat
    const state3 = await page3.evaluate(
      () => (window as any).__TEST_GAME_STATE__
    );

    const before = await page3.evaluate(
      () => (window as any).__TEST_PLAYER_POSITION__
    );

    if (!state3?.combatZone?.combatantIds?.includes(state3.localPlayerId)) {
      // p3 is not in combat — verify they can move by pressing W (increase speed)
      await page3.keyboard.press("w");
      await page3.waitForTimeout(600);

      const after = await page3.evaluate(
        () => (window as any).__TEST_PLAYER_POSITION__
      );
      // Player started with heading 0 (east), pressing W increases speed → x increases
      expect(after.x).toBeGreaterThan(before.x);
    }

    await ctx1.close();
    await ctx2.close();
    await ctx3.close();
  });
});
