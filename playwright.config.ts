import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "packages/web/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:7431",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node packages/web/e2e/server.mjs",
    url: "http://127.0.0.1:7431",
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "tablet", use: { viewport: { width: 780, height: 900 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
  ],
});
