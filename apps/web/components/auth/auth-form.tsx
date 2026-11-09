"use client";

// Auth form (spec §14.1: inline server errors, password visibility toggle;
// acceptance: empty fields use native validation, wrong password shows a
// server-side error). One component for both modes.
import { useActionState, useId, useState } from "react";
import { loginAction, registerAction, type AuthFormState } from "@/lib/auth/actions";
import { BANNER_ERROR, BTN_PRIMARY, ICON_BTN } from "@/lib/ui";
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

/* Left-edge gradient accent that lights up while a field row holds focus
   (wrap the input in a `group relative` div to use it). A separate pill
   layered over the input — not a border override — so the shared .ff-field
   input recipe in globals.css stays untouched. Tokens only (--ff-grad), so
   it survives the light-scheme flip; the opacity transition collapses to a
   single frame under the global prefers-reduced-motion rule. */
export function FocusSpine() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-[7px] left-[3px] w-[3px] rounded-full opacity-0 transition-opacity duration-200 group-focus-within:opacity-100"
      style={{ background: "var(--ff-grad)" }}
    />
  );
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
        <p className={BANNER_ERROR} role="alert">
          {formError}
        </p>
      )}

      {mode === "register" && (
        <div className="ff-field">
          <label htmlFor={nameId}>Name</label>
          <div className="group relative">
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
            <FocusSpine />
          </div>
          {errors.name !== undefined && (
            <p className="ff-field-error" id={`${nameId}-error`} role="alert">
              {errors.name}
            </p>
          )}
        </div>
      )}

      <div className="ff-field">
        <label htmlFor={emailId}>Email</label>
        <div className="group relative">
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
          <FocusSpine />
        </div>
        {errors.email !== undefined && (
          <p className="ff-field-error" id={`${emailId}-error`} role="alert">
            {errors.email}
          </p>
        )}
      </div>

      <div className="ff-field">
        <label htmlFor={passwordId}>Password</label>
        <div className="group relative">
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
          <FocusSpine />
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
