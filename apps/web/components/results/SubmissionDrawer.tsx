// T15 — submission detail drawer (spec §14.1.5): timestamp, token, status,
// variables, hidden fields, meta + every answer grouped by block with labels
// from the document snapshot. Detail comes from GET /documents/:id/submissions/:sid.

"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Block } from "../../lib/results-bridge";
import {
  describeError,
  formatAnswer,
  formatDateTime,
  isQuestionBlock,
  questionLabel,
  type ResultsClient,
  type SubmissionDTO,
} from "../../lib/results";
import { Skeleton, errorCodeOf, friendlyErrorMessage } from "./Feedback";
import { StatusPill } from "./StatusPill";

export interface SubmissionDrawerProps {
  docId: string;
  client: ResultsClient;
  /** The row that was clicked (renders immediately; detail refines it). */
  submission: SubmissionDTO;
  /** Document snapshot blocks — labels come from here. */
  blocks: Block[];
  onClose: () => void;
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-xs font-medium text-[var(--ff-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm tabular-nums text-[var(--ff-fg)]">{children}</dd>
    </div>
  );
}

function RecordSection({
  title,
  record,
  emptyHint,
}: {
  title: string;
  record: Record<string, unknown>;
  emptyHint: string;
}) {
  const entries = Object.entries(record);
  return (
    <section>
      <h3 className="text-sm font-semibold text-[var(--ff-fg)]">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--ff-muted)]">{emptyHint}</p>
      ) : (
        <dl className="mt-1 divide-y divide-[var(--ff-border)]">
          {entries.map(([key, value]) => (
            <MetaRow key={key} label={key}>
              <span className="break-all font-mono text-xs">{scalar(value)}</span>
            </MetaRow>
          ))}
        </dl>
      )}
    </section>
  );
}

export function SubmissionDrawer({ docId, client, submission, blocks, onClose }: SubmissionDrawerProps) {
  const [detail, setDetail] = useState<SubmissionDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorCode, setLoadErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, body scroll locks, close button takes focus (spec §14.4 a11y).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setLoadErrorCode(null);
    client
      .getSubmission(docId, submission.id)
      .then((s) => {
        if (!cancelled) setDetail(s);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(describeError(err));
          setLoadErrorCode(errorCodeOf(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, docId, submission.id, nonce]);

  const view: SubmissionDTO = detail ?? submission;
  const questionBlocks = blocks.filter(isQuestionBlock);
  const submittedAt = view.completedAt ?? view.startedAt;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="submission-drawer-title">
      <button
        type="button"
        aria-label="Close submission drawer"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white dark:bg-black/60"
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-[var(--ff-card)] shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--ff-border)] px-6 py-4">
          <div className="min-w-0">
            <h2 id="submission-drawer-title" className="text-base font-semibold text-[var(--ff-fg)]">
              Submission
            </h2>
            <p className="mt-0.5 truncate font-mono text-xs text-[var(--ff-muted)]">{view.publicToken || view.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill status={view.status} />
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-[var(--ff-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)] hover:text-[var(--ff-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ff-primary)]"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M14 6l-8 8" />
              </svg>
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-5">
          {loadError ? (
            <div
              role="alert"
              className="rounded-[calc(var(--ff-radius)*0.66)] border border-[color-mix(in_srgb,var(--ff-fg)_12%,transparent)] bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] px-3 py-2 text-sm"
            >
              <p className="font-medium text-[var(--ff-fg)]">{friendlyErrorMessage(loadErrorCode)}</p>
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-[var(--ff-muted)]">Technical details</summary>
                <p className="mt-1 break-words font-mono text-xs leading-relaxed text-[var(--ff-muted)]">{loadError}</p>
              </details>
              <button
                type="button"
                onClick={() => setNonce((n) => n + 1)}
                className="mt-2 text-sm font-medium text-[var(--ff-primary)] hover:underline"
              >
                Retry
              </button>
            </div>
          ) : null}

          <section>
            <h3 className="text-sm font-semibold text-[var(--ff-fg)]">Metadata</h3>
            <dl className="mt-1 divide-y divide-[var(--ff-border)]">
              <MetaRow label="Submitted">{formatDateTime(submittedAt)}</MetaRow>
              <MetaRow label="Started">{formatDateTime(view.startedAt)}</MetaRow>
              <MetaRow label="Status"><StatusPill status={view.status} /></MetaRow>
              <MetaRow label="Version">
                <span className="font-mono text-xs">{view.versionId || "—"}</span>
              </MetaRow>
              <MetaRow label="Token">
                <span className="break-all font-mono text-xs">{view.publicToken || "—"}</span>
              </MetaRow>
              {loading ? <MetaRow label="Detail"><Skeleton className="h-4 w-24" /></MetaRow> : null}
            </dl>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-[var(--ff-fg)]">Answers</h3>
            <p className="mt-0.5 text-xs text-[var(--ff-muted)]">Grouped by block, labels from the document snapshot.</p>
            <ul className="mt-3 space-y-3">
              {questionBlocks.map((block) => {
                const value = view.answers?.[block.id];
                const text = formatAnswer(block, value);
                return (
                  <li
                    key={block.id}
                    className={`rounded-[calc(var(--ff-radius)*0.66)] border px-4 py-3 ${
                      text === "—" ? "border-dashed border-[var(--ff-border)] bg-[var(--ff-bg)]" : "border-[var(--ff-border)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-[var(--ff-fg)]">{questionLabel(block)}</p>
                      <span className="shrink-0 rounded bg-[color-mix(in_srgb,var(--ff-fg)_8%,transparent)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ff-muted)]">
                        {block.kind}
                      </span>
                    </div>
                    <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${text === "—" ? "text-[var(--ff-muted)]" : "text-[var(--ff-fg)]"}`}>
                      {text}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <RecordSection title="Hidden fields" record={view.hidden ?? {}} emptyHint="No hidden fields (UTM, referrer) captured." />
          <RecordSection title="Variables" record={view.variables ?? {}} emptyHint="No logic variables were set." />
          <RecordSection title="Meta" record={view.meta ?? {}} emptyHint="No device metadata recorded." />
        </div>
      </div>
    </div>
  );
}
