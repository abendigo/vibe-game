import type { Page } from "@playwright/test";

let playerCounter = 0;

/**
 * Create a unique player name to avoid collisions between tests.
 * Kept under 24 characters to fit the login input's maxlength.
 */
export function uniqueName(prefix = "P"): string {
  // Use last 6 digits of timestamp + counter for short unique names
  const ts = Date.now() % 1_000_000;
  return `${prefix}${ts}_${++playerCounter}`;
}

/**
 * Navigate to the game, fill the login form, submit, and wait for
 * authentication to complete (login screen removed + game state received).
 */
export async function joinGame(
  page: Page,
  name: string,
  password = "testpass"
): Promise<void> {
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 10_000 });

  // Fill and submit the login form
  await page.fill("#login-name", name);
  await page.fill("#login-password", password);
  await page.click("#login-btn");

  // Wait for login screen to disappear (removed from DOM on successful auth)
  await page.waitForFunction(
    () => !document.getElementById("login-screen"),
    { timeout: 10_000 }
  );

  // Wait for game state to be received (player position set)
  await page.waitForFunction(
    () => (window as any).__TEST_PLAYER_POSITION__ != null,
    { timeout: 10_000 }
  );
}

/**
 * Read the text content of a HUD element.
 */
export async function getHudText(
  page: Page,
  id: string
): Promise<string> {
  return page.locator(`#${id}`).textContent() ?? "";
}
