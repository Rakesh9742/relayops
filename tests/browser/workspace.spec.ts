import { test, expect } from "@playwright/test";
test("incident, memory correction, persistence and tenant switch work end to end", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A calmer kind of on-call." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New incident", exact: true }).click();
  await expect(page.locator(".scenario-options button")).toHaveCount(4);
  await page.getByRole("button", { name: /Memory correction/ }).click();
  await page.getByLabel("Incident title").fill("Browser verification incident");
  await page
    .getByRole("button", { name: "Create incident", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Browser verification incident",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & resolve" }),
  ).toBeVisible({ timeout: 90000 });
  // The panel switched to the live graph while agents worked; it shows the
  // steps they took and what they wrote.
  await expect(page.locator(".incident-tabs button.active")).toHaveText(
    /Live graph/,
  );
  expect(await page.locator(".live-steps button").count()).toBeGreaterThan(2);
  await expect(page.locator(".live-changes")).toContainText("ROOT_CAUSE");
  expect(
    await page.locator(".graph-viewport.live .graph-node").count(),
  ).toBeGreaterThan(10);
  // Atlas and Sage each recorded the graph queries behind their conclusions.
  await page.getByRole("button", { name: "Live timeline" }).click();
  await expect(page.locator(".trace-list")).toHaveCount(2);
  await expect(page.locator(".investigation-card")).toContainText(
    "Root cause:",
  );
  await page.locator(".trace button").first().click();
  await expect(page.locator(".trace.open li").first()).toBeVisible();
  await expect(page.locator(".plan-forbidden")).toContainText("restart");
  await page.getByRole("button", { name: "Introduce new evidence" }).click();
  await expect(page.getByText("Nothing gets lost here.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume from checkpoint" }).click();
  await expect(
    page.getByRole("button", { name: "Approve & resolve" }),
  ).toBeVisible({ timeout: 90000 });
  await page.getByRole("button", { name: "Approve & resolve" }).click();
  await expect(
    page.getByText("Recovery verified and saved to memory"),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Ask your agent team" })
    .fill("What happened last time?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toBeVisible({
    timeout: 60000,
  });
  await page.reload();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(page.locator(".message.user")).toHaveText(
    /What happened last time/,
  );
  await page
    .getByRole("button", { name: "Shared memory", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your team’s collective memory." }),
  ).toBeVisible();
  const graphView = page.getByRole("button", { name: "Graph view" });
  if (await graphView.count()) await graphView.click();
  // The graph is built from real nodes and edges, including people and decisions.
  expect(await page.locator(".graph-node").count()).toBeGreaterThan(40);
  await page.locator(".graph-node", { hasText: "Priya Natarajan" }).click();
  await expect(page.locator(".graph-title")).toContainText("Priya Natarajan");
  await page.getByRole("button", { name: "Clear" }).click();
  await page
    .locator(".graph-node", { hasText: "Recover an exhausted" })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.locator(".workspace-switch").click();
  await page.getByRole("button", { name: "or Orbit Financial" }).click();
  await expect(page.locator(".workspace-switch")).toContainText(
    "Orbit Financial",
  );
  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  await expect(page.getByText("Browser verification incident")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("mobile layout stays within the viewport and navigation works", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A calmer kind of on-call." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Agent team", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Meet your incident team." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
