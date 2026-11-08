// npm run qa:login
//
// Opens a browser on the sign-in page and waits for you to sign in, then
// saves the session for the signed-in tests. Run it again when they start
// failing at sign-in.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const STATE = "e2e/.auth/user.json";
const BASE = "http://localhost:3000";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${BASE}/sign-in`);
console.log("Sign in in the browser window. Waiting up to ten minutes…");
// Signed in with an organization is the dashboard, whatever steps Clerk
// shows on the way (choosing an organization, a verification code).
await page.getByRole("heading", { name: "Analyses" }).waitFor({ timeout: 10 * 60_000 });
mkdirSync(path.dirname(STATE), { recursive: true });
await context.storageState({ path: STATE });
console.log(`Saved the session to ${STATE}.`);
await browser.close();
