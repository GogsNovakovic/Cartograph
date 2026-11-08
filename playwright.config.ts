import { defineConfig, devices } from "@playwright/test";

// QA against the dev server. Signed-out tests need nothing; signed-in ones
// use the session `npm run qa:login` saves after you sign in by hand once,
// because Clerk's sign-in is yours to complete, not a script's.
export const AUTH_STATE = "e2e/.auth/user.json";

export default defineConfig({
  testDir: "e2e",
  // One dev server and one shared database: tests that change an analysis
  // must not race each other.
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/about",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "signed-out", testMatch: "signed-out/**/*.spec.ts" },
    { name: "signed-in", testMatch: "signed-in/**/*.spec.ts", use: { storageState: AUTH_STATE } },
  ],
});
