// Dependency-free fallback renderer for auth emails (ticket #5). This is the
// DEFAULT: the web composition root overrides it with the React Email
// templates (apps/web/lib/auth/emails.tsx). Kept pure + dependency-free so
// core tests can assert subjects/links without a React runtime.
// Rendering NEVER includes answer values (spec §4 logging rule).
import type { AuthEmailRenderer } from "./tokens";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const defaultAuthEmailRenderer: AuthEmailRenderer = {
  passwordReset({ url, expiresInMinutes }): { subject: string; html: string; text: string } {
    const subject = "Reset your FormForge password";
    const text = [
      "We received a request to reset your FormForge password.",
      "",
      `Reset link (valid for ${expiresInMinutes} minutes):`,
      url,
      "",
      "If you didn't request this, you can safely ignore this email.",
    ].join("\n");
    const html = [
      `<p>We received a request to reset your FormForge password.</p>`,
      `<p><a href="${escapeHtml(url)}">Choose a new password</a></p>`,
      `<p>This link expires in ${expiresInMinutes} minutes. If you didn't request it, you can safely ignore this email.</p>`,
    ].join("\n");
    return { subject, html, text };
  },

  emailVerification({ url }): { subject: string; html: string; text: string } {
    const subject = "Verify your FormForge email";
    const text = [
      "Welcome to FormForge! Confirm your email address to finish setting up your account.",
      "",
      `Verify link: ${url}`,
    ].join("\n");
    const html = [
      `<p>Welcome to FormForge! Confirm your email address to finish setting up your account.</p>`,
      `<p><a href="${escapeHtml(url)}">Verify my email</a></p>`,
    ].join("\n");
    return { subject, html, text };
  },
};
