'use client';

// Settings panel primitives (builder spec §6.6): section shells with the
// shared small-caps header + divider, compact field rows and inline notes.
// Styling uses Tailwind utilities + the ff-set-* classes appended to
// app/globals.css (this milestone's prefix).

import type { ReactNode } from "react";

/** A §6.6 settings section: sticky small-caps header with divider, stacked
 * rows. The header pins to the pane scrollport (bg matches .ff-pane). */
export function SettingsSection({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="ff-set-section" data-testid={testId}>
      <h3 className="ff-set-section-title sticky top-0 z-10 bg-[color:var(--ff-card)] pt-1">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** One labelled settings row: control on top, hint/error below. Uses the
 * design-system .ff-field label/input hierarchy. Errors only style the field —
 * they never block autosave (§6.6). */
export function FieldRow({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="ff-field">
      <label className="font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="ff-set-note ff-set-note--error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="ff-set-note">{hint}</p>
      ) : null}
    </div>
  );
}

/** Inline informational / warning note (§6.6, §24: plan gates render in-place
 * notes, never modals). */
export function InlineNote({
  tone = "info",
  children,
  testId,
}: {
  tone?: "info" | "warn";
  children: ReactNode;
  testId?: string;
}) {
  return (
    <p className={`ff-set-note${tone === "warn" ? " ff-set-note--warn" : ""}`} data-testid={testId}>
      {children}
    </p>
  );
}

/** Shared compact control styling for panel inputs/selects — tokenized
 * (deep surface, violet focus ring, danger border when aria-invalid). */
export const FF_SET_INPUT_CLASS =
  "ff-set-input min-h-9 w-full rounded-lg border border-[color:var(--ff-border)] bg-[color:var(--ff-bg)] px-2.5 py-1.5 text-sm text-[color:var(--ff-fg)] outline-none placeholder:text-[color:var(--ff-muted)] focus-visible:border-[color:var(--ff-primary)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ff-primary)_22%,transparent)] disabled:opacity-50 aria-[invalid=true]:border-[color:var(--ff-danger)]";
