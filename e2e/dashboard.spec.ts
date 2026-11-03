import { test, expect, type Page } from "@playwright/test";

const sender = {
  id: "b065793a-47cf-45fa-b134-635319072c49",
  name: "Oliver Brown",
  email: "oliver@ethereal.email",
  hourlyLimit: 20,
  minDelaySeconds: 2,
};
const session = {
  user: {
    id: "f5621fdc-e69b-46fc-95ec-a9ce52c81f8f",
    name: "Oliver Brown",
    email: "oliver@example.com",
    avatar: null,
  },
  isAdmin: true,
  hasPassword: false,
  csrfToken: "browser-test-only",
  senderDefaults: { hourlyLimit: 20, minDelaySeconds: 2, maxHourlyLimit: 1000 },
};
const email = {
  id: "08e8e102-1f49-43c1-8326-9f1c218a251b",
  recipient: "alex@example.com",
  subject: "Meeting follow-up",
  body: "Hi Alex, just wanted to follow up on our meeting.",
  status: "SCHEDULED",
  sender,
  scheduledAt: "2030-01-01T10:00:00Z",
  sentAt: null,
  starred: false,
  archived: false,
  trashedAt: null,
  batch: { attachments: [] },
  errorMessage: null,
};
async function fixture(
  page: Page,
  options: { authenticated?: boolean; empty?: boolean; fail?: boolean } = {},
) {
  // Browser-only network fixtures. No test identities or auth bypass exist in the production app.
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === "/api/auth/me") {
      if (options.authenticated === false)
        return route.fulfill({
          status: 401,
          json: { error: { message: "Please sign in." } },
        });
      data = session;
    } else if (path === "/api/senders") data = [sender];
    else if (path === "/api/slack/status") data = { connected: false };
    else if (path === "/api/emails/counts")
      data = { scheduled: 1, sent: 1, starred: 0, archive: 0, trash: 0 };
    else if (path === "/api/emails/schedule")
      data = {
        batchId: "browser-test",
        count: 2,
        replayed: false,
        queuePending: false,
      };
    else if (path === "/api/auth/logout") data = { loggedOut: true };
    else if (path.startsWith("/api/emails")) {
      if (options.fail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Search is temporarily unavailable." } },
        });
      data = {
        items: options.empty
          ? []
          : [
              {
                ...email,
                ...(path.endsWith("/sent")
                  ? { status: "SENT", sentAt: "2030-01-01T10:00:00Z" }
                  : {}),
              },
            ],
        total: options.empty ? 0 : 1,
        page: 1,
        pageSize: 20,
      };
    } else
      return route.fulfill({
        status: 404,
        json: { error: { message: "Unexpected test request." } },
      });
    return route.fulfill({ json: { data } });
  });
}

test("signed-out users see a real Google OAuth entry point", async ({
  page,
}) => {
  await fixture(page, { authenticated: false });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("link", { name: "Continue with Google" }),
  ).toHaveAttribute("href", "/api/auth/google");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("profile, scheduled/sent lists, message detail and logout work", async ({
  page,
}, testInfo) => {
  await fixture(page);
  await page.goto("/dashboard");
  await expect(page.getByText("Oliver Brown", { exact: true })).toBeVisible();
  await expect(
    page.getByText("oliver@example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "scheduled emails" }),
  ).toContainText("Meeting follow-up");
  await page.screenshot({
    path: testInfo.outputPath("dashboard.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /^To: alex@example.com/ }).click();
  await expect(
    page.getByRole("heading", { name: "Meeting follow-up" }),
  ).toBeVisible();
  await expect(page.getByText(email.body, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Meeting follow-up", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Sent/ })
    .click();
  await expect(page.getByRole("list", { name: "sent emails" })).toContainText(
    "Sent",
  );
  await page
    .getByRole("button", { name: /Oliver Brown oliver@example.com/ })
    .click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("CSV compose submits selected time, pacing, deduplicated leads and an idempotency key", async ({
  page,
}, testInfo) => {
  await fixture(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.locator('input[accept=".csv,.txt"]').setInputFiles({
    name: "leads.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,email\nAlex,alex@example.com\nSam,sam@example.com\nAlex,alex@example.com",
    ),
  });
  await expect(page.getByRole("status")).toContainText("2 valid recipients");
  await expect(page.getByRole("status")).toContainText("1 duplicates removed");
  await page.getByPlaceholder("Subject", { exact: true }).fill("Introduction");
  await page
    .getByRole("textbox", { name: "Email message" })
    .fill("Hello from ReachInbox.");
  await page.getByRole("button", { name: "Choose send time" }).click();
  const future = new Date(Date.now() + 3600000);
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Start date and time").fill(local);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByLabel("Delay between emails in seconds").fill("5");
  await page.getByLabel("Hourly Limit").fill("10");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("compose.png"),
    fullPage: true,
  });
  const requestPromise = page.waitForRequest(
    (r) => r.url().endsWith("/api/emails/schedule") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Send Later", exact: true }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    subject: "Introduction",
    recipients: ["alex@example.com", "sam@example.com"],
    delaySeconds: 5,
    hourlyLimit: 10,
  });
  expect(request.postDataJSON().startTime).toBe(new Date(local).toISOString());
  expect(request.headers()["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/);
  expect(request.headers()["x-csrf-token"]).toBe(session.csrfToken);
  await expect(
    page.getByRole("status").filter({ hasText: "2 emails scheduled." }),
  ).toBeVisible();
});

test("empty and service error states remain usable", async ({ page }) => {
  await fixture(page, { empty: true });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "No scheduled emails" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compose", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/api/**");
  await fixture(page, { fail: true });
  await page.getByRole("button", { name: "Refresh emails" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to load emails");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Slack connection collects the channel before the real authorize redirect", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Slack Connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Slack", exact: true })
    .click();
  await expect(page.getByLabel("Slack channel ID")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to Slack" }),
  ).toBeVisible();
});

test("mailbox fits the viewport without horizontal overflow", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("list", { name: "scheduled emails" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
