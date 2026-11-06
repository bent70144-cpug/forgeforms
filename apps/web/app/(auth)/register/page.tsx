import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-balance">Create your account</h1>
      <p className="ff-subtle">A personal workspace is set up for you automatically.</p>
      <AuthForm mode="register" />
      <p className="ff-auth-alt">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </>
  );
}
