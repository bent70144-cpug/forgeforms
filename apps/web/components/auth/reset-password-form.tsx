"use client";

// Reset-password form (ticket #5): carries the emailed token, sets the new
// password, then the action redirects to /login?reset=1.
import { useActionState, useId, useState } from "react";
import { resetPasswordAction, type AuthFormState } from "@/lib/auth/actions";

const initialState: AuthFormState = {};

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const uid = useId();
  const passwordId = `${uid}-password`;
  const tokenId = `${uid}-token`;

  const fieldError = state.error?.details.find((d) => d.path === "password")?.message;
  const formError =
    state.error !== undefined && state.error.details.length === 0 ? state.error.message : null;

  return (
    <form action={formAction} className="ff-form" aria-busy={pending}>
      {formError !== null && (
        <p className="ff-banner ff-banner-error" role="alert">
          {formError}
        </p>
      )}

      <input id={tokenId} name="token" type="hidden" value={token} />

      <div className="ff-field">
        <label htmlFor={passwordId}>New password</label>
        <div className="ff-password">
          <input
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            aria-invalid={fieldError !== undefined}
            aria-describedby={fieldError !== undefined ? `${passwordId}-error` : undefined}
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
        {fieldError !== undefined && (
          <p className="ff-field-error" id={`${passwordId}-error`} role="alert">
            {fieldError}
          </p>
        )}
      </div>

      <button type="submit" className="ff-button ff-button-primary" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
