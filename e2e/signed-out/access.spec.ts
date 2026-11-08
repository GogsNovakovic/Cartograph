import { expect, test } from "@playwright/test";

test("an analysis page sends a signed-out visitor to sign-in", async ({ page }) => {
  await page.goto("/analyses/97733922-329d-4745-a2e0-c3ec37534cc5");
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=/);
});

test.describe("the agent's lookups", () => {
  test("refuse a request with no credential", async ({ request }) => {
    const response = await request.post("/api/agent/overview", { data: {} });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "No credential." });
  });

  test("refuse a forged credential", async ({ request }) => {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const forged = `${part({ alg: "ES256", typ: "JWT", kid: "k" })}.${part({ exp: 9_999_999_999 })}.c2ln`;
    const response = await request.post("/api/agent/overview", { data: {}, headers: { authorization: `Bearer ${forged}` } });
    expect(response.status()).toBe(401);
  });

  test("name no lookup that doesn't exist", async ({ request }) => {
    const response = await request.post("/api/agent/drop", { data: {} });
    expect(response.status()).toBe(404);
  });
});
