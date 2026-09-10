import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    launchOptions: { args: ["--no-sandbox"] },
  },
  webServer: {
    // Production build + real server, never a dev server. Built from the repo
    // root; the server serves the built SPA and runs an in-process PGlite
    // database so the suite provisions its own clean state.
    command: `npm --prefix .. run build && npm --prefix .. run start`,
    url: `${baseURL}/api/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NODE_ENV: "production",
      NODE_OPTIONS: "--max-old-space-size=2048",
      DB_DRIVER: "pglite",
      MAIL_TRANSPORT: "console",
      PORT: String(PORT),
      APP_BASE_URL: baseURL,
      SESSION_COOKIE_SECRET: "e2e-session-secret-that-is-long-enough-ok",
      SEED_DEMO: "false",
    },
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } }],
});
