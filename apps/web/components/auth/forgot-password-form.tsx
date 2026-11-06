"use client";

// Forgot-password form (spec §14.1: inline server errors; ticket #5).
// Success shows the same neutral confirmation for known and unknown emails.
import { useActionState, useId } from "react";
import { forgotPasswordAction, type AuthFormState } from "@/lib/auth/actions";

const initialState: AuthFormState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);
  const uid = useId();
  const emailId = `${uid}-email`;

  return (
    <form action={formAction} className="ff-form" aria-busy={pending}>
      {state.success !== undefined && (
        <p className="ff-banner" role="status">
          {state.success}
        </p>
      )}
      {state.error !== undefined && state.error.details.length === 0 && (
        <p className="ff-banner ff-banner-error" role="alert">
          {state.error.message}
        </p>
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
        />
      </div>

      <button type="submit" className="ff-button ff-button-primary" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
