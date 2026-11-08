import { expect, test } from "@playwright/test";

// Phase 13's acceptance check, signed out.

test("the root explains the product to a signed-out visitor", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("See the shape of code you didn't write.");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings).toEqual([
    "Answers you get by clicking.",
    "How it works",
    "It knows what frameworks put where.",
    "What it deliberately doesn't do.",
  ]);
});

test("the hero's field goes through sign-in into the analysis", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Public GitHub repository URL" }).fill("github.com/sindresorhus/ky");
  await page.getByRole("button", { name: "Map repository" }).click();
  await page.waitForURL(/\/sign-in/);
  const back = new URL(page.url()).searchParams.get("redirect_url") ?? "";
  expect(back).toContain("/analyse?url=github.com%2Fsindresorhus%2Fky");
});

for (const theme of ["Light", "Dark"] as const) {
  test(`the ${theme.toLowerCase()} theme applies, illustrations included`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: theme }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase());
    // The page and its first figure both follow the tokens: a dark page has a
    // dark background, a light one a light background.
    const luminance = await page.evaluate(() => {
      const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)!.map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    });
    expect(theme === "Dark" ? luminance < 0.3 : luminance > 0.7).toBe(true);
    await expect(page.locator("svg").first()).toBeVisible();
  });
}

test("nothing overflows sideways at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the landing page also answers at its own path", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("See the shape of code you didn't write.");
});
