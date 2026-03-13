import type { Page } from "@playwright/test";

let playerCounter = 0;

/**
 * Create a unique player name to avoid collisions between tests.
 */
export function uniqueName(prefix = "Player"): string {
  return `${prefix}_${Date.now()}_${++playerCounter}`;
}

/**
 * Override window.prompt to auto-respond with name and password,
 * then navigate to the page and wait for the canvas to appear.
 */
export async function joinGame(
  page: Page,
  name: string,
  password = "testpass"
): Promise<void> {
  let promptCount = 0;
  await page.addInitScript(
    ({ name, password }) => {
      let count = 0;
      window.prompt = () => {
        count++;
        return count === 1 ? name : password;
      };
    },
    { name, password }
  );

  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 10_000 });
  // Give the WebSocket time to connect and auth to complete
  await page.waitForTimeout(500);
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
