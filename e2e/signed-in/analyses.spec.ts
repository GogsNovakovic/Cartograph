import { expect, test } from "@playwright/test";
import { analysisOf, db } from "../db.ts";

// Uses the organization's existing map of sindresorhus/ky. Analyse it once
// from the dashboard before the first run of these tests.
const OWNER = "sindresorhus";
const NAME = "ky";

test("the dashboard lists the organization's analyses", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Analyses" })).toBeVisible();
  await expect(page.getByRole("link", { name: `${OWNER}/${NAME}` })).toBeVisible();
});

test.describe.serial("re-running a map", () => {
  test("a failed re-run leaves the map on screen and says why", async ({ page }) => {
    const analysis = await analysisOf(OWNER, NAME);
    expect(analysis.result_run, "the analysis needs a map to keep").not.toBeNull();
    // What a re-run that failed while fetching leaves behind.
    const { error } = await db
      .from("analyses")
      .update({ status: "failed", stage: "fetching", failure_reason: "QA: a re-run that failed.", completed_at: new Date().toISOString() })
      .eq("id", analysis.id);
    expect(error).toBeNull();

    await page.goto(`/analyses/${analysis.id}`);
    await expect(page.locator(".react-flow")).toBeVisible();
    await expect(page.getByText("Running again failed while fetching:")).toBeVisible();
    await expect(page.getByText("QA: a re-run that failed.")).toBeVisible();
    await expect(page.getByText(`built from ${analysis.commit_sha!.slice(0, 7)}`)).toBeVisible();
  });

  test("running again keeps the old map until the new one replaces it", async ({ page }) => {
    test.setTimeout(5 * 60_000);
    const before = await analysisOf(OWNER, NAME);
    await page.goto(`/analyses/${before.id}`);
    await page.getByRole("button", { name: "Run again" }).click();

    // The old map stays while the new run works, with its progress above it.
    await expect(page.getByText("Running again", { exact: true })).toBeVisible();
    await expect(page.locator(".react-flow")).toBeVisible();
    await expect(page.getByRole("button", { name: "Run again" })).toHaveCount(0);

    // The page reloads itself onto the new map when the run ends.
    await expect(page.getByText("Running again", { exact: true })).toHaveCount(0, { timeout: 4 * 60_000 });
    await expect(page.getByText(/Running again failed/)).toHaveCount(0);
    await expect(page.locator(".react-flow")).toBeVisible();

    const after = await analysisOf(OWNER, NAME);
    expect(after.status).toBe("complete");
    expect(after.result_run).not.toBe(before.result_run);
    // The replaced map's rows are gone; only the new run's remain.
    const { data: runs } = await db.from("files").select("run").eq("analysis_id", before.id).neq("run", after.result_run!);
    expect(runs).toEqual([]);
  });
});
