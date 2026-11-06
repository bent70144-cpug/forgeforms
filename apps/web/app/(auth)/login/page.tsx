import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { GoogleSignInButton } from "@/components/auth/google-button";

export const metadata: Metadata = { title: "Log in" };

const ERROR_COPY: Record<string, string> = {
  google_unavailable: "Google sign-in is not available right now.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "That Google sign-in link expired. Please try again.",
  google_failed: "We couldn't complete Google sign-in. Please try again.",
  verify_expired: "That verification link is invalid or has expired.",
  verify_rate_limited: "Too many verification attempts. Please wait a minute.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string; verified?: string }>;
}) {
  const { error, reset, verified } = await searchParams;
  const oauthError = typeof error === "string" ? ERROR_COPY[error] : undefined;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">Log in</h1>
      <p className="ff-subtle">Welcome back. Enter your details to continue.</p>

      {reset === "1" && (
        <p className="ff-banner ff-banner-success" role="status">
          Your password has been updated. Log in with the new password.
        </p>
      )}
      {verified === "1" && (
        <p className="ff-banner ff-banner-success" role="status">
          Email verified — thanks!
        </p>
      )}
      {oauthError !== undefined && (
        <p className="ff-banner ff-banner-error" role="alert">
          {oauthError}
        </p>
      )}

      {/* SPEC-NOTE: server-rendered conditional — hidden when GOOGLE_CLIENT_ID is unset. */}
      <GoogleSignInButton />
      <AuthForm mode="login" />
      <p className="ff-auth-alt">
        <Link
          href="/forgot"
          className="underline-offset-4 transition-colors hover:text-[var(--ff-accent)] hover:underline"
        >
          Forgot your password?
        </Link>
      </p>
      <p className="ff-auth-alt">
        New to FormForge?{" "}
        <Link
          href="/register"
          className="underline-offset-4 transition-colors hover:text-[var(--ff-accent)] hover:underline"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}
