'use client';

// Settings panel primitives (builder spec §6.6): section shells with the
// shared small-caps header + divider, compact field rows and inline notes.
// Styling uses Tailwind utilities + the ff-set-* classes appended to
// app/globals.css (this milestone's prefix).

import type { ReactNode } from "react";

/** A §6.6 settings section: small-caps header, divider, stacked rows. */
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
      <h3 className="ff-set-section-title">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** One labelled settings row: control on top, hint/error below. Errors only
 * style the field — they never block autosave (§6.6). */
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
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" htmlFor={htmlFor}>
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

/** Shared compact control styling for panel inputs/selects. */
export const FF_SET_INPUT_CLASS =
  "ff-set-input min-h-9 w-full rounded-md border border-[color:var(--ff-border)] bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-[color:var(--ff-primary)] disabled:opacity-50";
