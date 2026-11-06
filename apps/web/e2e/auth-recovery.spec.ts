// Playwright E2E — ticket #5 acceptance chain (WRITTEN, NOT RUN locally:
// the sandbox has no browsers and no live DB; CI runs this with the
// docker-compose stack up — see playwright.config.ts for the env contract).
//
// Covers:
//   1. register → forgot password → token from the dev transport outbox →
//      set new password → log in with it (acceptance criterion 1);
//   2. reset link is single-use (second submission fails);
//   3. Google button is hidden when GOOGLE_CLIENT_ID is unset (criterion 3's
//      negative branch — the positive branch needs real Google credentials);
//   4. login is rate limited per IP+email (criterion 4).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const OUTBOX_DIR = process.env.DEV_MAIL_OUTBOX ?? ".e2e-mail";

async function lastOutboxMessage(): Promise<{ to: string; html: string; text: string }> {
  const lines = readFileSync(join(OUTBOX_DIR, "dev-emails.jsonl"), "utf8")
    .trim()
    .split("\n");
  return JSON.parse(lines[lines.length - 1]!) as { to: string; html: string; text: string };
}

test.describe.serial("T05 auth recovery", () => {
  const email = `e2e-${Date.now()}@example.com`;
  const oldPassword = "original-pass-123";
  const newPassword = "replacement-pass-456";

  test("register a fresh account", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: false }).first().fill(oldPassword);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    // Sign back out so the reset flow starts logged-out.
    await page.getByRole("button", { name: /log out|sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("request reset → receive token (dev transport) → set new password → log in with it", async ({ page }) => {
    await page.goto("/forgot");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("Check your inbox");

    const message = await lastOutboxMessage();
    expect(message.to).toBe(email);
    const link = /\/reset-password\?token=[A-Za-z0-9_-]+/.exec(message.text)?.[0];
    expect(link).toBeDefined();

    await page.goto(link!);
    await page.getByLabel("New password").fill(newPassword);
    await page.getByRole("button", { name: "Set new password" }).click();

    // Redirected to login with the success banner; old password is dead.
    await expect(page).toHaveURL(/\/login\?reset=1/);
    await expect(page.getByRole("status")).toContainText("password has been updated");

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: false }).first().fill(newPassword);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("reset token is single-use", async ({ page }) => {
    // Request another reset, use the link, then reuse the SAME link.
    await page.goto("/forgot");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    const message = await lastOutboxMessage();
    const link = /\/reset-password\?token=[A-Za-z0-9_-]+/.exec(message.text)?.[0]!;

    await page.goto(link);
    await page.getByLabel("New password").fill("single-use-pass-1");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page).toHaveURL(/\/login\?reset=1/);

    await page.goto(link);
    await page.getByLabel("New password").fill("second-use-pass-2");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  });

  test("Google button is hidden when GOOGLE_CLIENT_ID is unset", async ({ page }) => {
    test.skip(Boolean(process.env.GOOGLE_CLIENT_ID), "env has Google configured");
    await page.goto("/login");
    await expect(page.getByTestId("google-sign-in")).toHaveCount(0);
  });

  test("login is rate limited per IP+email", async ({ page }) => {
    await page.goto("/login");
    for (let attempt = 0; attempt < 10; attempt++) {
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: false }).first().fill("definitely-wrong-pass");
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByText(/Invalid email or password/i)).toBeVisible();
    }
    // 11th attempt → rate limited, no more credential errors.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: false }).first().fill("definitely-wrong-pass");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/Too many attempts/i)).toBeVisible();
  });
});
