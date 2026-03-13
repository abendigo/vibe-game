import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  webServer: [
    {
      command: "npm run dev:server",
      port: 3001,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev:client",
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
  reporter: [["html", { outputFolder: "playwright-report" }], ["line"]],
});
