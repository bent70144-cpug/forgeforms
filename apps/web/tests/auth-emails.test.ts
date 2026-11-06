// React Email auth templates (ticket #5: "token emailed via … React Email
// template"). Pure rendering — no transport, no DB.
import { describe, expect, it } from "vitest";
import { reactAuthEmailRenderer } from "@/lib/auth/emails";

const RESET_URL = "https://app.formforge.test/reset-password?token=AbC_123-xyz";
const VERIFY_URL = "https://app.formforge.test/api/auth/verify-email?token=V3rIfY_9";

describe("reactAuthEmailRenderer (React Email templates)", () => {
  it("renders the reset email with the single-use link and 1h expiry copy", () => {
    const email = reactAuthEmailRenderer.passwordReset({ url: RESET_URL, expiresInMinutes: 60 });

    expect(email.subject).toBe("Reset your FormForge password");
    expect(email.html).toContain(RESET_URL);
    expect(email.html).toContain("expires in 60 minutes");
    expect(email.html).toContain("<html");
    expect(email.html).toContain("Reset your password");
    expect(email.text).toContain(RESET_URL);
    expect(email.text).toContain("valid for 60 minutes");
  });

  it("renders the verification email with the verify link", () => {
    const email = reactAuthEmailRenderer.emailVerification({ url: VERIFY_URL });

    expect(email.subject).toBe("Verify your FormForge email");
    expect(email.html).toContain(VERIFY_URL);
    expect(email.html).toContain("Verify my email");
    expect(email.text).toContain(VERIFY_URL);
  });

  it("escapes ampersands in the URL for HTML but keeps the text link raw", () => {
    const email = reactAuthEmailRenderer.passwordReset({
      url: "https://app.test/reset-password?a=1&b=2",
      expiresInMinutes: 60,
    });
    // The href attribute carries an escaped ampersand (valid HTML); the
    // plain-text part keeps the raw URL so mail clients linkify it correctly.
    expect(email.html).toContain('href="https://app.test/reset-password?a=1&amp;b=2"');
    expect(email.html).not.toContain("?a=1&b=2");
    expect(email.text).toContain("https://app.test/reset-password?a=1&b=2");
  });
});
