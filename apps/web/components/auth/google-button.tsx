// Server-rendered Google button (ticket #5, spec §14.1). Hidden entirely when
// GOOGLE_CLIENT_ID is unset — a server-rendered conditional, so the client
// bundle never even learns about the OAuth entry point (acceptance criteria).
import { googleOAuthConfig } from "@/lib/auth/google";

export function GoogleSignInButton({ origin }: { origin?: string }) {
  const config = googleOAuthConfig(origin);
  if (!config) return null;

  return (
    <>
      <a
        href="/api/auth/signin/google"
        className="ff-btn ff-btn-secondary transition-colors"
        data-testid="google-sign-in"
        aria-label="Continue with Google"
      >
        Continue with Google
      </a>
      <p className="ff-auth-divider" role="separator">
        or
      </p>
    </>
  );
}
