import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: `http://localhost:${process.env.VISUAL_PORT ?? 5173}`,
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm vite --port ${process.env.VISUAL_PORT ?? 5173} --strictPort`,
    url: `http://localhost:${process.env.VISUAL_PORT ?? 5173}`,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
