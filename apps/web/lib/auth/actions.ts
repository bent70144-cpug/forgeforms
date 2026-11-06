// Server actions for register/login/logout + forgot/reset password (issue #3,
// ticket #5; server actions are an approved surface). Errors are returned to
// the client in the spec §4 body shape so forms can render inline field errors.
"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashToken } from "@formforge/core/identity";
import {
  errorBody,
  loginUser,
  logoutUser,
  preAuthCtx,
  registerUser,
} from "@formforge/core/identity";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/auth.config";
import { getIdentityDeps, getRequestIdentityDeps } from "./container";
import {
  checkLoginRateLimit,
  runForgotPassword,
  runResetPassword,
  runSendEmailVerification,
} from "./recovery-flow";
import { getAuthRateLimiters } from "./rate-limit";

export type AuthErrorBody = {
  code: string;
  message: string;
  details: ReadonlyArray<{ path?: string; message: string }>;
};

export type AuthFormState = {
  error?: AuthErrorBody;
  /** Neutral success copy (e.g. the forgot-password confirmation). */
  success?: string;
};

// NOTE: a "use server" file may only export async functions — the empty
// initial state is defined in the client component (components/auth/auth-form.tsx).

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

/** Best-effort request origin (APP_URL override → x-forwarded headers → host). */
async function currentOrigin(): Promise<string> {
  const headerList = await headers();
  const fromEnv = process.env.APP_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Client IP for per-IP+email rate limiting (spec §17). */
async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headerList.get("x-real-ip") ?? "unknown";
}

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const ctx = preAuthCtx();
  const result = await registerUser(ctx, getIdentityDeps(), {
    name: field(formData, "name"),
    email: field(formData, "email"),
    password: field(formData, "password"),
  });
  if (!result.ok) return { error: errorBody(result.error).error };

  // Ticket #5: send the verification email (best-effort — never blocks signup).
  try {
    const origin = await currentOrigin();
    await runSendEmailVerification({
      deps: await getRequestIdentityDeps(origin),
      email: result.value.user.email,
      origin,
    });
  } catch {
    // Verification mail is auxiliary; signup must succeed regardless.
  }

  await setSessionCookie(result.value.sessionToken);
  redirect("/dashboard");
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email");
  // Ticket #5 acceptance: login endpoints rate limited per IP+email.
  const blocked = checkLoginRateLimit({
    ip: await clientIp(),
    email,
    limiter: getAuthRateLimiters().login,
  });
  if (blocked) return { error: blocked.error };

  const ctx = preAuthCtx();
  const result = await loginUser(ctx, getIdentityDeps(), {
    email,
    password: field(formData, "password"),
  });
  if (!result.ok) return { error: errorBody(result.error).error };

  await setSessionCookie(result.value.sessionToken);
  redirect("/dashboard");
}

// Bound to <form action>: React passes FormData, but logout reads the session
// from the cookie — so the handler takes no parameters (still assignable to
// the form-action type, and keeps the shared eslint no-unused-vars rule happy).
export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await logoutUser(preAuthCtx(), getIdentityDeps(), { token });
  }
  jar.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

// --- ticket #5: forgot / reset password --------------------------------------

export async function forgotPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = await runForgotPassword({
    deps: await getRequestIdentityDeps(await currentOrigin()),
    email: field(formData, "email"),
    ip: await clientIp(),
    limiter: getAuthRateLimiters().forgotPassword,
    origin: await currentOrigin(),
  });
  if (!result.ok) return { error: result.error };
  // Neutral confirmation — identical for known and unknown emails.
  return { success: result.message ?? "Check your inbox for the reset link." };
}

export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const token = field(formData, "token");
  const result = await runResetPassword({
    deps: getIdentityDeps(),
    token,
    password: field(formData, "password"),
    ip: await clientIp(),
    tokenHash: hashToken(token),
    limiter: getAuthRateLimiters().resetPassword,
  });
  if (!result.ok) return { error: result.error };

  // Password changed (all old sessions revoked) → sign in again.
  redirect("/login?reset=1");
}
