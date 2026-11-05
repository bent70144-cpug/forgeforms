// Server actions for register/login/logout (issue #3: server actions are an
// approved surface). Errors are returned to the client in the spec §4 body
// shape so forms can render inline field errors.
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  errorBody,
  loginUser,
  logoutUser,
  preAuthCtx,
  registerUser,
} from "@formforge/core/identity";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/auth.config";
import { getIdentityDeps } from "./container";

export type AuthErrorBody = {
  code: string;
  message: string;
  details: Array<{ path: string; message: string }>;
};

export type AuthFormState = {
  error?: AuthErrorBody;
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

  await setSessionCookie(result.value.sessionToken);
  redirect("/dashboard");
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const ctx = preAuthCtx();
  const result = await loginUser(ctx, getIdentityDeps(), {
    email: field(formData, "email"),
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
