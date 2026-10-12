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
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Introduce new evidence" }).click();
  await expect(page.getByText("Nothing gets lost here.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume from checkpoint" }).click();
  await expect(
    page.getByRole("button", { name: "Approve & resolve" }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Approve & resolve" }).click();
  await expect(
    page.getByText("Recovery verified and saved to memory"),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Ask your agent team" })
    .fill("What happened last time?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toBeVisible();
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
  await page.locator(".graph-node").first().click();
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
