'use client';

// Settings toggle row (builder spec §6.6): checkbox styled as a switch.
// Toggles apply their op IMMEDIATELY on change (§6.6 — only text inputs are
// debounced). Gated switches render disabled with an inline note (§24), so
// `note` is rendered by the caller next to the control.

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
      <label className="flex min-h-9 flex-1 cursor-pointer items-center gap-2 text-sm" htmlFor={testId ? `${testId}-toggle` : undefined}>
        <input
          id={testId ? `${testId}-toggle` : undefined}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          data-testid={testId}
          onChange={(event) => onChange(event.target.checked)}
          className="ff-set-switch"
        />
        <span>{label}</span>
      </label>
      {hint ? <span className="ff-set-note text-right">{hint}</span> : null}
    </div>
  );
}
