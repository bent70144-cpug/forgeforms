"use client";

// Reset-password form (ticket #5): carries the emailed token, sets the new
// password, then the action redirects to /login?reset=1.
import { useActionState, useId, useState } from "react";
import { resetPasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { BANNER_ERROR, BTN_PRIMARY, ICON_BTN } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
import { FocusSpine } from "@/components/auth/auth-form";

const initialState: AuthFormState = {};

/* ---------- password strength meter (display-only, client-side) ---------- */

type Strength = { score: 1 | 2 | 3 | 4; label: string; color: string };

const STRENGTH_LEVELS: Record<1 | 2 | 3 | 4, { label: string; color: string }> = {
  1: { label: "Weak", color: "var(--ff-danger)" },
  2: { label: "Fair", color: "var(--ff-warning)" },
  3: { label: "Good", color: "var(--ff-accent)" },
  4: { label: "Strong", color: "var(--ff-success)" },
};

// Pure heuristic: length + character variety. Mirrors nothing on the server —
// it is a hint, not validation (the action still enforces the real rules).
function passwordStrength(value: string): Strength {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(value),
  ).length;
  if (variety >= 2) score += 1;
  if (variety >= 3) score += 1;
  const level = Math.min(Math.max(score, 1), 4) as 1 | 2 | 3 | 4;
  return { score: level, ...STRENGTH_LEVELS[level] };
}

function StrengthMeter({ password }: { password: string }) {
  if (password.length === 0) return null;
  const strength = passwordStrength(password);
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-[var(--ff-muted)]">Password strength</span>
        <span className="text-xs font-medium" style={{ color: strength.color }}>
          {strength.label}
        </span>
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className="h-1 flex-1 rounded-full"
            style={{ background: segment <= strength.score ? strength.color : "var(--ff-border)" }}
          />
        ))}
      </div>
    </div>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const uid = useId();
  const passwordId = `${uid}-password`;
  const tokenId = `${uid}-token`;

  const fieldError = state.error?.details.find((d) => d.path === "password")?.message;
  const formError =
    state.error !== undefined && state.error.details.length === 0 ? state.error.message : null;

  return (
    <form action={formAction} className="ff-form" aria-busy={pending}>
      {formError !== null && (
        <p className={BANNER_ERROR} role="alert">
          {formError}
        </p>
      )}

      <input id={tokenId} name="token" type="hidden" value={token} />

      <div className="ff-field">
        <label htmlFor={passwordId}>New password</label>
        <div className="group relative">
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
            style={{ paddingRight: "2.75rem" }}
            onChange={(event) => setPassword(event.target.value)}
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
        <StrengthMeter password={password} />
        {fieldError !== undefined && (
          <p className="ff-field-error" id={`${passwordId}-error`} role="alert">
            {fieldError}
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
            Saving…
          </>
        ) : (
          "Set new password"
        )}
      </button>
    </form>
  );
}
