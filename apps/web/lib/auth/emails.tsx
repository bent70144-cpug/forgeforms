// React Email templates for the auth flows (ticket #5, spec §12 `send-reset`
// / `send-verify`).
//
// SPEC-NOTE: ticket wording is "Resend React Email template". The repo does
// not carry @react-email/components (zero new deps offline), so these are
// hand-rolled React components in the same structural style (Html → Body →
// section blocks, inline styles, no external CSS — the React Email layout
// contract) rendered with react-dom/server, which is already a dependency.
// Swapping the internals for @react-email/components later is a drop-in
// change; the `AuthEmailRenderer` port (see @formforge/core/identity) does not
// change.
//
// Rendering is pure (props in → html out); links are the only dynamic content
// and they never embed answer values (spec §4 logging rule).
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthEmailRenderer, RenderedAuthEmail } from "@formforge/core/identity";

const styles = {
  body: {
    margin: 0,
    padding: "24px",
    backgroundColor: "#f6f7f9",
    fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: "#1f2937",
  } as const,
  card: {
    maxWidth: 480,
    margin: "0 auto",
    padding: "32px",
    backgroundColor: "#ffffff",
    borderRadius: 8,
  } as const,
  heading: { fontSize: 20, margin: "0 0 12px" } as const,
  paragraph: { fontSize: 14, lineHeight: "20px", margin: "0 0 16px" } as const,
  button: {
    display: "inline-block",
    padding: "10px 18px",
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    borderRadius: 6,
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 600,
  } as const,
  footer: { fontSize: 12, color: "#6b7280", margin: "16px 0 0" } as const,
};

function EmailShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={styles.body}>
        <div style={styles.card}>{children}</div>
      </body>
    </html>
  );
}

export function ResetPasswordEmail({ url, expiresInMinutes }: { url: string; expiresInMinutes: number }) {
  return (
    <EmailShell>
      <h1 style={styles.heading}>Reset your password</h1>
      <p style={styles.paragraph}>
        We received a request to reset your FormForge password. Click the button below to choose a
        new one.
      </p>
      <p>
        <a href={url} style={styles.button}>
          Choose a new password
        </a>
      </p>
      <p style={styles.paragraph}>
        This link expires in {expiresInMinutes} minutes and can be used once. If you didn&apos;t
        request it, you can safely ignore this email — your password stays unchanged.
      </p>
      <p style={styles.footer}>
        Or paste this link into your browser: <a href={url}>{url}</a>
      </p>
    </EmailShell>
  );
}

export function VerifyEmailEmail({ url }: { url: string }) {
  return (
    <EmailShell>
      <h1 style={styles.heading}>Verify your email</h1>
      <p style={styles.paragraph}>
        Welcome to FormForge! Confirm this address to finish setting up your account.
      </p>
      <p>
        <a href={url} style={styles.button}>
          Verify my email
        </a>
      </p>
      <p style={styles.footer}>
        Or paste this link into your browser: <a href={url}>{url}</a>
      </p>
    </EmailShell>
  );
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

/** The composition-root override of the core `AuthEmailRenderer` port. */
export const reactAuthEmailRenderer: AuthEmailRenderer = {
  passwordReset(input: { url: string; expiresInMinutes: number }): RenderedAuthEmail {
    return {
      subject: "Reset your FormForge password",
      html: render(<ResetPasswordEmail url={input.url} expiresInMinutes={input.expiresInMinutes} />),
      text: [
        "We received a request to reset your FormForge password.",
        "",
        `Reset link (valid for ${input.expiresInMinutes} minutes):`,
        input.url,
        "",
        "If you didn't request this, you can safely ignore this email.",
      ].join("\n"),
    };
  },
  emailVerification(input: { url: string }): RenderedAuthEmail {
    return {
      subject: "Verify your FormForge email",
      html: render(<VerifyEmailEmail url={input.url} />),
      text: [
        "Welcome to FormForge! Confirm your email address to finish setting up your account.",
        "",
        `Verify link: ${input.url}`,
      ].join("\n"),
    };
  },
};
