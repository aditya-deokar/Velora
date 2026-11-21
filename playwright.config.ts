import { defineConfig, devices } from "@playwright/test";
const baseURL =
  process.env.VELORA_TEST_URL ??
  "http://127.0.0.1:" +
    String(process.env.VELORA_TEST_PORT ?? 4173);
export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/browser/**/*.spec.ts", "**/three/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: process.env.VELORA_TEST_URL
    ? undefined
    : {
        command: `npm run preview -- --config vite.test.config.ts --port ${process.env.VELORA_TEST_PORT ?? 4173} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 30000,
      },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  reporter: [["list"], ["html", { open: "never" }]],
});
