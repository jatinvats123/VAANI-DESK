import { expect, test } from "@playwright/test";

/** Happy paths: signed-in owner sees the dashboard and manages a booking. */

test("overview renders stats and live call panel", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Calls handled")).toBeVisible();
  await expect(page.getByText("Revenue saved")).toBeVisible();
  await expect(page.getByText("Live calls")).toBeVisible();
});

test("create a booking from the dashboard, then cancel it", async ({ page }) => {
  const customer = `E2E Customer ${Date.now()}`;
  // Random afternoon quarter-hour slot keeps repeat runs conflict-free.
  const hour = 12 + Math.floor(Math.random() * 7);
  const minute = ["00", "15", "30", "45"][Math.floor(Math.random() * 4)];
  const time = `${String(hour).padStart(2, "0")}:${minute}`;

  await page.goto("/bookings");
  await page.getByRole("button", { name: "+ New booking" }).click();
  await page.getByLabel("Customer name").fill(customer);
  await page.getByLabel("Phone").fill("9876501234");
  await page.getByLabel("Time").fill(time);
  await page.getByRole("button", { name: "Create booking" }).click();
  await expect(page.getByText("Booking created.")).toBeVisible();

  // The list revalidates server-side; the new row appears with its actions.
  await page.reload();
  const row = page.locator("li", { hasText: customer });
  await expect(row).toBeVisible();
  await expect(row.getByText("Confirmed")).toBeVisible();

  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("li", { hasText: customer }).getByText("Cancelled")).toBeVisible();
});

test("settings shows the business and services", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Opening hours")).toBeVisible();
  await expect(page.getByText("Haircut")).toBeVisible();
});
