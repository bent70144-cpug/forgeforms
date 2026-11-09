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
      {/* 14px/500 label — inline size beats the unlayered .ff-field > label rule */}
      <label className="font-medium" htmlFor={htmlFor} style={{ fontSize: "0.875rem" }}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="ff-set-note ff-set-note--error" role="alert" style={{ color: "var(--ff-danger)" }}>
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
    <p
      className={`ff-set-note${tone === "warn" ? " ff-set-note--warn" : ""}`}
      data-testid={testId}
      style={tone === "warn" ? { color: "var(--ff-warning)" } : undefined}
    >
      {children}
    </p>
  );
}

/** Shared control styling for panel inputs/selects — the canonical Meridian
 * .ff-input recipe (recessed surface, hairline, ultramarine focus ring). */
export const FF_SET_INPUT_CLASS = "ff-input";
