"use client";

// Forgot-password form (spec §14.1: inline server errors; ticket #5).
// Success shows the same neutral confirmation for known and unknown emails.
import { useActionState, useId } from "react";
import { forgotPasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { BANNER, BANNER_ERROR, BTN_PRIMARY } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
import { FocusSpine } from "@/components/auth/auth-form";

const initialState: AuthFormState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);
  const uid = useId();
  const emailId = `${uid}-email`;

  return (
    <form action={formAction} className="ff-form" aria-busy={pending}>
      {state.success !== undefined && (
        <p className={BANNER} role="status">
          {state.success}
        </p>
      )}
      {state.error !== undefined && state.error.details.length === 0 && (
        <p className={BANNER_ERROR} role="alert">
          {state.error.message}
        </p>
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
          />
          <FocusSpine />
        </div>
      </div>

      <button
        type="submit"
        className={`${BTN_PRIMARY} w-full justify-center`}
        disabled={pending}
      >
        {pending ? (
          <>
            <Icon name="spinner" size={16} />
            Sending…
          </>
        ) : (
          "Send reset link"
        )}
      </button>
    </form>
  );
}
