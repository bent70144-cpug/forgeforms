import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { GoogleSignInButton } from "@/components/auth/google-button";
import { BANNER_ERROR, BANNER_SUCCESS } from "@/lib/ui";
import { AuthHeading } from "@/app/(auth)/layout";

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
      <AuthHeading>Welcome back</AuthHeading>
      <p className="ff-subtle">Log in to your FormForge workspace.</p>

      {reset === "1" && (
        <p className={BANNER_SUCCESS} role="status">
          Your password has been updated. Log in with the new password.
        </p>
      )}
      {verified === "1" && (
        <p className={BANNER_SUCCESS} role="status">
          Email verified — thanks!
        </p>
      )}
      {oauthError !== undefined && (
        <p className={BANNER_ERROR} role="alert">
          {oauthError}
        </p>
      )}

      {/* Credentials first; the Google block (hairline "or continue with"
          + white slab) sits below the single ultramarine submit. */}
      <AuthForm mode="login" />
      {/* SPEC-NOTE: server-rendered conditional — hidden when GOOGLE_CLIENT_ID is unset. */}
      <GoogleSignInButton />

      <p className="ff-auth-alt">
        <Link
          href="/forgot"
          className="underline-offset-4 transition-colors hover:text-[var(--ff-primary)] hover:underline"
        >
          Forgot your password?
        </Link>
      </p>
      <p className="ff-auth-alt">
        New to FormForge?{" "}
        <Link
          href="/register"
          className="underline-offset-4 transition-colors hover:text-[var(--ff-primary)] hover:underline"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}
