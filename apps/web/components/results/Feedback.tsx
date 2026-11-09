// T15 — shared loading / error states (spec §14.2: skeletons, never blank
// screens; errors are friendly first, technical on demand) plus the editorial
// QuoteCard used for written answers (white card, 1px hairline, oversized
// Sora quotation mark in a terracotta 10% tint, ink text). Empty states moved
// to the shared primitive (components/ui/empty-state.tsx).

"use client";

import { ResultsApiError } from "../../lib/results";
import { BANNER_ERROR, BTN_SECONDARY_SM } from "../../lib/ui";
import { Icon } from "../ui/icons";

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

/**
 * Shimmering placeholder block. NOTE (B5): this replicates the `.ff-skeleton`
 * recipe with Tailwind token utilities instead of using the class itself —
 * `.ff-skeleton` locks `height: 7rem` in an unlayered block, which would
 * override the `h-*` sizing utilities every caller passes.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[var(--ff-radius)] bg-[color-mix(in_srgb,var(--ff-fg)_6%,var(--ff-card))] motion-reduce:animate-none ${className}`}
    />
  );
}

/**
 * Editorial quote card for written answers: white surface, 1px hairline, an
 * oversized Sora opening mark in a quiet terracotta 10% tint, ink text at
 * 15px. Decorative mark is aria-hidden — the answer text is read verbatim.
 */
export function QuoteCard({ text }: { text: string }) {
  return (
    <figure className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-4">
      <span
        aria-hidden="true"
        className="-mb-3 block select-none font-semibold leading-[0.6]"
        style={{
          fontFamily: "var(--ff-font-heading)",
          fontSize: "2.75rem",
          color: "color-mix(in srgb, var(--ff-accent) 10%, transparent)",
        }}
      >
        “
      </span>
      <blockquote className="mt-2 break-words text-[15px] leading-relaxed text-[var(--ff-fg)]">
        {text}
      </blockquote>
    </figure>
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
        <Skeleton key={i} className="h-28" />
      ))}
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
    <div role="alert" className={BANNER_ERROR}>
      <p className="font-medium text-balance">{friendlyErrorMessage(code)}</p>
      <div className="mt-2.5">
        <button type="button" onClick={onRetry} className={BTN_SECONDARY_SM}>
          <Icon name="refresh" size={12} />
          Try again
        </button>
      </div>
      <details className="mt-2.5">
        <summary className="cursor-pointer text-xs">Technical details</summary>
        <p className="mt-2 break-words rounded-xl bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] p-2.5 text-left font-mono text-xs leading-relaxed text-[var(--ff-muted)]">
          {message}
        </p>
      </details>
    </div>
  );
}
