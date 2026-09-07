import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: { command: "npm run dev --prefix ..", url: "http://127.0.0.1:3000/en", reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
