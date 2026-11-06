// T15 — shared loading / empty / error states (spec §14.2: skeletons, never
// blank screens; empty states are actionable).

"use client";

import type { ReactNode } from "react";
import { ResultsApiError } from "../../lib/results";

/**
 * Friendly one-liners per API error code (spec §4). The raw code/message is
 * never shown as the headline — it stays available inside a collapsed
 * <details> for debugging.
 */
const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "This document doesn’t exist or you don’t have access to it.",
  FORBIDDEN: "You don’t have access to this document.",
  VALIDATION: "That request wasn’t valid.",
  CONFLICT: "This document changed recently — refresh and try again.",
  RATE_LIMITED: "Too many requests — wait a moment and retry.",
  PLAN_LIMIT: "Your plan doesn’t include this.",
  INTERNAL: "Something went wrong loading results.",
};

/** Headline text for an error state, from an optional machine code. */
export function friendlyErrorMessage(code?: string | null): string {
  if (code != null && FRIENDLY_ERROR_MESSAGES[code] != null) {
    return FRIENDLY_ERROR_MESSAGES[code]!;
  }
  return FRIENDLY_ERROR_MESSAGES.INTERNAL!;
}

/** Machine code of a fetch failure, if it is a typed API error. */
export function errorCodeOf(err: unknown): string | null {
  return err instanceof ResultsApiError ? err.code : null;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse motion-reduce:animate-none rounded-md bg-[color-mix(in_srgb,var(--ff-fg)_10%,transparent)] ${className}`}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="p-4" role="status" aria-label="Loading submissions">
      <div className="mb-4 flex gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className={`grid grid-cols-2 gap-4 lg:grid-cols-4`}
      role="status"
      aria-label="Loading summary"
    >
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ff-empty">
      <svg
        className="h-10 w-10 text-[var(--ff-muted)]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
        />
      </svg>
      <p className="text-base font-semibold text-balance text-[var(--ff-fg)]">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm leading-relaxed text-[var(--ff-muted)]">{description}</p>
      ) : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  code,
  onRetry,
}: {
  /** Raw technical message (describeError output) — shown only in <details>. */
  message: string;
  /** Machine error code (e.g. "NOT_FOUND") — picks the friendly headline. */
  code?: string | null;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-6 py-10 text-center"
    >
      <p className="text-base font-semibold text-balance text-[var(--ff-fg)]">
        {friendlyErrorMessage(code)}
      </p>
      <button type="button" onClick={onRetry} className="ff-button ff-button-primary mt-4 text-sm">
        Try again
      </button>
      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-[var(--ff-muted)] transition-colors hover:text-[var(--ff-fg)]">
          Technical details
        </summary>
        <p className="mx-auto mt-2 max-w-md break-words text-left font-mono text-xs leading-relaxed text-[var(--ff-muted)]">
          {message}
        </p>
      </details>
    </div>
  );
}
