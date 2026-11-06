"use client";

// Auth form (spec §14.1: inline server errors, password visibility toggle;
// acceptance: empty fields use native validation, wrong password shows a
// server-side error). One component for both modes.
import { useActionState, useId, useState } from "react";
import { loginAction, registerAction, type AuthFormState } from "@/lib/auth/actions";
import { BTN_PRIMARY, ICON_BTN } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";

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
        <div className="relative">
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
            style={{ paddingRight: "2.75rem" }}
          />
          <button
            type="button"
            className={`${ICON_BTN} absolute top-1/2 right-1.5 -translate-y-1/2`}
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            <Icon name={showPassword ? "eyeOff" : "eye"} size={16} />
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
        className={`${BTN_PRIMARY} w-full justify-center`}
        disabled={pending}
      >
        {pending ? (
          <>
            <Icon name="spinner" size={16} />
            {mode === "login" ? "Signing in…" : "Creating account…"}
          </>
        ) : mode === "login" ? (
          "Log in"
        ) : (
          "Create account"
        )}
      </button>
    </form>
  );
}
