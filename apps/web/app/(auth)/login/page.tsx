import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <h1>Log in</h1>
      <p className="ff-subtle">Welcome back. Enter your details to continue.</p>
      <AuthForm mode="login" />
      <p className="ff-auth-alt">
        New to FormForge? <Link href="/register">Create an account</Link>
      </p>
    </>
  );
}
