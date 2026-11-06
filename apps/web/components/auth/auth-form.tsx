"use client";

// Auth form (spec §14.1: inline server errors, password visibility toggle;
// acceptance: empty fields use native validation, wrong password shows a
// server-side error). One component for both modes.
import { useActionState, useId, useState } from "react";
import { loginAction, registerAction, type AuthFormState } from "@/lib/auth/actions";

// Empty initial state — kept client-side because "use server" modules may only
// export async functions.
const initialState: AuthFormState = {};

function fieldErrors(state: AuthFormState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const detail of state.error?.details ?? []) {
    if (!detail.path) continue;
    if (out[detail.path] === undefined) out[detail.path] = detail.message;
  }
  return out;
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [state, formAction, pending] = useActionState(
    mode === "login" ? loginAction : registerAction,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);

  const errors = fieldErrors(state);
  // Form-level banner only when the error carries no field details.
  const formError =
    state.error !== undefined && state.error.details.length === 0 ? state.error.message : null;

  const uid = useId();
  const emailId = `${uid}-email`;
  const passwordId = `${uid}-password`;
  const nameId = `${uid}-name`;

  return (
    <form action={formAction} className="ff-form" aria-busy={pending}>
      {formError !== null && (
        <p className="ff-banner ff-banner-error" role="alert">
          {formError}
        </p>
      )}

      {mode === "register" && (
        <div className="ff-field">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Ana Smith"
            maxLength={100}
            aria-invalid={errors.name !== undefined}
            aria-describedby={errors.name !== undefined ? `${nameId}-error` : undefined}
          />
          {errors.name !== undefined && (
            <p className="ff-field-error" id={`${nameId}-error`} role="alert">
              {errors.name}
            </p>
          )}
        </div>
      )}

      <div className="ff-field">
        <label htmlFor={emailId}>Email</label>
        <input
          id={emailId}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={errors.email !== undefined}
          aria-describedby={errors.email !== undefined ? `${emailId}-error` : undefined}
        />
        {errors.email !== undefined && (
          <p className="ff-field-error" id={`${emailId}-error`} role="alert">
            {errors.email}
          </p>
        )}
      </div>

      <div className="ff-field">
        <label htmlFor={passwordId}>Password</label>
        <div className="ff-password">
          <input
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={mode === "register" ? 8 : undefined}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
            aria-invalid={errors.password !== undefined}
            aria-describedby={errors.password !== undefined ? `${passwordId}-error` : undefined}
          />
          <button
            type="button"
            className="ff-password-toggle"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        {errors.password !== undefined && (
          <p className="ff-field-error" id={`${passwordId}-error`} role="alert">
            {errors.password}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="ff-btn ff-btn-primary transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}
