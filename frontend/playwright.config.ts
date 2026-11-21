import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

// End-to-end tests: a real Chrome uses the real frontend + backend + database.
// Playwright starts both servers itself (or reuses ones already running locally).
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    actionTimeout: 15_000, // a click that can't find its button fails after 15s, not 90s
    // On failure, keep a screenshot, a video and a step-by-step trace to see what went wrong.
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // The FastAPI backend. First start downloads the embedding models, so allow time.
      command: "uv run uvicorn app.main:app --port 8000",
      cwd: "../backend",
      url: "http://localhost:8000/api/health",
      reuseExistingServer: !isCI,
      timeout: 300_000,
      env: { LANGSMITH_TRACING: "false" },
    },
    {
      // In CI: the production build (built in an earlier step). Locally: the dev server.
      command: isCI ? "npm run start" : "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !isCI,
      timeout: 180_000,
    },
  ],
});
