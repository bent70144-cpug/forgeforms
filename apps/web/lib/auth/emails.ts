// Auth email templates for the recovery flows (ticket #5, spec §12 `send-reset`
// / `send-verify`): reset password + email verification, "React Email" layout
// style (Html → Body → card, inline styles only, no external CSS).
//
// SPEC-NOTE (two documented deviations from the ticket's literal "Resend React
// Email template" wording):
//   1. The repo does not carry @react-email/components (zero new deps offline).
//   2. react-dom/server (what renders React Email markup) is BANNED inside the
//      Next.js server graph — `next dev`/`next build` hard-error on any module
//      reachable from a Server Component that imports it, which 500s every auth
//      page (found by the T05 dev-server smoke check). So templates are
//      hand-rendered HTML strings in the same structural style, and the emails
//      module must stay free of react-dom/server.
// Swapping in @react-email/components later is a drop-in change at the
// `AuthEmailRenderer` port seam (see @formforge/core/identity) — render it
// outside the RSC import chain when that happens.
//
// Rendering is pure (props in → html out); links are the only dynamic content
// and they never embed answer values (spec §4 logging rule). All dynamic values
// are HTML-escaped for attribute/text contexts; plain-text parts keep the raw
// URL so terminals and mail clients can click through directly.
import type { AuthEmailRenderer, RenderedAuthEmail } from "@formforge/core/identity";

// --- escaping -----------------------------------------------------------------

/** Escapes a value for HTML text content and double-quoted attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// --- layout (mirrors the React Email component tree) --------------------------

const STYLE_BODY =
  "margin:0;padding:24px;background-color:#f6f7f9;" +
  "font-family:-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;color:#1f2937";
const STYLE_CARD =
  "max-width:480px;margin:0 auto;padding:32px;background-color:#ffffff;border-radius:8px";
const STYLE_HEADING = "font-size:20px;margin:0 0 12px";
const STYLE_PARAGRAPH = "font-size:14px;line-height:20px;margin:0 0 16px";
const STYLE_BUTTON =
  "display:inline-block;padding:10px 18px;background-color:#4f46e5;color:#ffffff;" +
  "border-radius:6px;text-decoration:none;font-size:14px;font-weight:600";
const STYLE_FOOTER = "font-size:12px;color:#6b7280;margin:16px 0 0";

function htmlShell(innerHtml: string): string {
  return (
    '<html lang="en">' +
    `<body style="${STYLE_BODY}">` +
    `<div style="${STYLE_CARD}">${innerHtml}</div>` +
    "</body></html>"
  );
}

function paragraph(style: string, innerHtml: string): string {
  return `<p style="${style}">${innerHtml}</p>`;
}

function heading(text: string): string {
  return `<h1 style="${STYLE_HEADING}">${escapeHtml(text)}</h1>`;
}

function button(label: string, url: string): string {
  return `<p><a href="${escapeHtml(url)}" style="${STYLE_BUTTON}">${escapeHtml(label)}</a></p>`;
}

/** "Or paste this link into your browser: <url>" footer used by both emails. */
function linkFooter(url: string): string {
  return paragraph(
    STYLE_FOOTER,
    `Or paste this link into your browser: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`,
  );
}

// --- templates ----------------------------------------------------------------

export function renderResetPasswordEmail(input: { url: string; expiresInMinutes: number }): string {
  return htmlShell(
    [
      heading("Reset your password"),
      paragraph(
        STYLE_PARAGRAPH,
        "We received a request to reset your FormForge password. Click the button below to choose a new one.",
      ),
      button("Choose a new password", input.url),
      paragraph(
        STYLE_PARAGRAPH,
        `This link expires in ${input.expiresInMinutes} minutes and can be used once. ` +
          "If you didn&#39;t request it, you can safely ignore this email — your password stays unchanged.",
      ),
      linkFooter(input.url),
    ].join(""),
  );
}

export function renderVerifyEmailEmail(input: { url: string }): string {
  return htmlShell([
    heading("Verify your email"),
    paragraph(
      STYLE_PARAGRAPH,
      "Welcome to FormForge! Confirm this address to finish setting up your account.",
    ),
    button("Verify my email", input.url),
    linkFooter(input.url),
  ].join(""));
}

function textLines(lines: string[]): string {
  return lines.join("\n");
}

// --- composition-root override of the core AuthEmailRenderer port -------------

export const reactAuthEmailRenderer: AuthEmailRenderer = {
  passwordReset(input: { url: string; expiresInMinutes: number }): RenderedAuthEmail {
    return {
      subject: "Reset your FormForge password",
      html: renderResetPasswordEmail(input),
      text: textLines([
        "We received a request to reset your FormForge password.",
        "",
        `Reset link (valid for ${input.expiresInMinutes} minutes):`,
        input.url,
        "",
        "If you didn't request this, you can safely ignore this email.",
      ]),
    };
  },
  emailVerification(input: { url: string }): RenderedAuthEmail {
    return {
      subject: "Verify your FormForge email",
      html: renderVerifyEmailEmail(input),
      text: textLines([
        "Welcome to FormForge! Confirm your email address to finish setting up your account.",
        "",
        `Verify link: ${input.url}`,
      ]),
    };
  },
};
