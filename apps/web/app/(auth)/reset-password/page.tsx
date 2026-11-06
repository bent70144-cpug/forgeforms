import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (typeof token !== "string" || token.length === 0) {
    return (
      <>
        <h1>Set a new password</h1>
        <p className="ff-banner ff-banner-error" role="alert">
          This reset link is missing its token. Request a new link to continue.
        </p>
        <p className="ff-auth-alt">
          <Link href="/forgot">Request a new reset link</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Set a new password</h1>
      <p className="ff-subtle">
        Choose a new password for your account. You&apos;ll be signed out everywhere else.
      </p>
      <ResetPasswordForm token={token} />
    </>
  );
}
