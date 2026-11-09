import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { AuthHeading } from "@/app/(auth)/layout";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading>Forgot your password?</AuthHeading>
      <p className="ff-subtle">
        We&apos;ll email you a one-time link to choose a new password. It expires after an hour.
      </p>
      <ForgotPasswordForm />
      <p className="ff-auth-alt">
        Remembered it?{" "}
        <Link
          href="/login"
          className="underline-offset-4 transition-colors hover:text-[var(--ff-primary)] hover:underline"
        >
          Log in
        </Link>
      </p>
    </>
  );
}
