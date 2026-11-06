import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">Forgot your password?</h1>
      <p className="ff-subtle">
        Enter your email and we&apos;ll send you a link to choose a new one. The link works once
        and expires after an hour.
      </p>
      <ForgotPasswordForm />
      <p className="ff-auth-alt">
        Remembered it?{" "}
        <Link
          href="/login"
          className="underline-offset-4 transition-colors hover:text-[var(--ff-accent)] hover:underline"
        >
          Log in
        </Link>
      </p>
    </>
  );
}
