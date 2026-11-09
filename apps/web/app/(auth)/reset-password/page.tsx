import type { Metadata } from "next";
import Link from "next/link";
import { BANNER_ERROR, BTN_SECONDARY } from "@/lib/ui";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { AuthHeading } from "@/app/(auth)/layout";

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
        <AuthHeading>Set a new password</AuthHeading>
        <p className={BANNER_ERROR} role="alert">
          This reset link is missing its token. Request a new link to continue.
        </p>
        <Link href="/forgot" className={`${BTN_SECONDARY} self-start`}>
          Request a new reset link
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading>Set a new password</AuthHeading>
      <p className="ff-subtle">
        Choose a new password for your account — you&apos;ll be signed out everywhere else.
      </p>
      <ResetPasswordForm token={token} />
    </>
  );
}
