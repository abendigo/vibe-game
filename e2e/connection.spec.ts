import { test, expect } from "@playwright/test";
import { joinGame, uniqueName, getHudText } from "./helpers.js";

test.describe("Connection & Auth", () => {
  test("player can connect and see the game canvas", async ({ page }) => {
    const name = uniqueName("Connect");
    await joinGame(page, name);

    // Game canvas (Pixi.js) should be visible
    const canvas = page.locator("canvas:not(#world-map-canvas)");
    await expect(canvas).toBeVisible();

    // Phase should show Exploring
    const phase = await getHudText(page, "phase-display");
    expect(phase).toContain("Exploring");
  });

  test("player count increments on join", async ({ page }) => {
    const name = uniqueName("Count");
    await joinGame(page, name);

    const count = await getHudText(page, "player-count");
    expect(count).toMatch(/Players: [1-9]/);
  });

  test("session token is stored in localStorage", async ({ page }) => {
    const name = uniqueName("Token");
    await joinGame(page, name);

    const token = await page.evaluate(() =>
      localStorage.getItem("game_session_token")
    );
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(token!.length).toBeGreaterThan(0);
  });

  test("player name is stored in localStorage", async ({ page }) => {
    const name = uniqueName("NameStore");
    await joinGame(page, name);

    const stored = await page.evaluate(() =>
      localStorage.getItem("game_player_name")
    );
    expect(stored).toBe(name);
  });
});
