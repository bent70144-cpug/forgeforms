'use client';

// Settings toggle row (builder spec §6.6): checkbox styled as a Meridian pill
// switch — 40×22 track (off = --ff-border-strong, on = ultramarine) with a
// card-white knob. Toggles apply their op IMMEDIATELY on change (§6.6 — only
// text inputs are debounced). Gated switches render disabled with an inline
// note (§24), so `note` is rendered by the caller next to the control.

export function ToggleRow({
  label,
  checked,
  onChange,
  disabled = false,
  hint,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label
        className="flex min-h-9 flex-1 cursor-pointer items-center gap-2.5 text-sm"
        htmlFor={testId ? `${testId}-toggle` : undefined}
      >
        <span className="relative inline-flex">
          <input
            id={testId ? `${testId}-toggle` : undefined}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={disabled}
            data-testid={testId}
            onChange={(event) => onChange(event.target.checked)}
            className={`peer h-[22px] w-10 shrink-0 appearance-none rounded-full border border-[color:var(--ff-border-strong)] bg-[color:var(--ff-border-strong)] transition-colors duration-200 ease-[var(--ff-ease-out)] checked:border-[color:var(--ff-primary)] checked:bg-[color:var(--ff-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ff-accent)] ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
          />
          {/* Knob — sibling span because <input> cannot host pseudo-elements. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[3px] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[color:var(--ff-card)] shadow-sm transition-transform duration-200 ease-[var(--ff-ease-out)] peer-checked:translate-x-[18px]"
          />
        </span>
        <span>{label}</span>
      </label>
      {hint ? <span className="ff-set-note text-right">{hint}</span> : null}
    </div>
  );
}
