import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthHeading } from "@/app/(auth)/layout";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage() {
  return (
    <>
      <AuthHeading>Create your account</AuthHeading>
      <p className="ff-subtle">A personal workspace is set up for you automatically.</p>
      <AuthForm mode="register" />
      <p className="ff-auth-alt">
        Already have an account?{" "}
        <Link
          href="/login"
          className="underline-offset-4 transition-colors hover:text-[var(--ff-accent)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
