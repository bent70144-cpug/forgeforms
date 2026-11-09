// T15 — submission detail drawer (spec §14.1.5): timestamp, token, status,
// variables, hidden fields, meta + every answer grouped by block with labels
// from the document snapshot. Detail comes from GET /documents/:id/submissions/:sid.
// Meridian: rendered through the shared Drawer primitive (Esc/backdrop
// close, scroll lock, focus trap + restore all live there); sections keep
// their data flow, with quiet mono uppercase section labels, mono meta
// label / ink value rows over hairline dividers, and quiet Q/A answer stacks
// (muted 12px question, ink answer).

"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Block } from "../../lib/results-bridge";
import {
  describeError,
  displayCell,
  formatAnswer,
  formatDateTime,
  isQuestionBlock,
  questionLabel,
  type ResultsClient,
  type SubmissionDTO,
} from "../../lib/results";
import { BADGE_MUTED, BANNER_ERROR, BTN_SECONDARY_SM } from "../../lib/ui";
import { Drawer } from "../ui/drawer";
import { Icon } from "../ui/icons";
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

/** Quiet mono uppercase section label shared by every drawer section. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ff-muted)]">
      {children}
    </h3>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-[var(--ff-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium tabular-nums text-[var(--ff-fg)]">
        {children}
      </dd>
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
      <SectionTitle>{title}</SectionTitle>
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
    <Drawer
      open
      onClose={onClose}
      width="32rem"
      title={`Submission ${displayCell(view.publicToken || view.id, 16)}`}
      description={`Submitted ${formatDateTime(submittedAt)}`}
    >
      <div className="space-y-7">
        {loadError ? (
          <div role="alert" className={BANNER_ERROR}>
            <p className="font-medium">{friendlyErrorMessage(loadErrorCode)}</p>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs">Technical details</summary>
              <p className="mt-1 break-words font-mono text-xs leading-relaxed">{loadError}</p>
            </details>
            <button
              type="button"
              onClick={() => setNonce((n) => n + 1)}
              className={`${BTN_SECONDARY_SM} mt-2`}
            >
              <Icon name="refresh" size={12} />
              Retry
            </button>
          </div>
        ) : null}

        <section>
          <SectionTitle>Metadata</SectionTitle>
          <dl className="mt-1 divide-y divide-[var(--ff-border)]">
            <MetaRow label="Submitted">
              <span className="font-mono text-xs">{formatDateTime(submittedAt)}</span>
            </MetaRow>
            <MetaRow label="Started">
              <span className="font-mono text-xs">{formatDateTime(view.startedAt)}</span>
            </MetaRow>
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
          <SectionTitle>Answers</SectionTitle>
          <p className="mt-0.5 text-xs text-[var(--ff-muted)]">
            Grouped by block, labels from the document snapshot.
          </p>
          <ul className="mt-3 divide-y divide-[var(--ff-border)]">
            {questionBlocks.map((block) => {
              const value = view.answers?.[block.id];
              const text = formatAnswer(block, value);
              const empty = text === "—";
              return (
                <li key={block.id} className="py-3.5 first:pt-0 last:pb-0">
                  {/* quiet question eyebrow, the ink answer carries the weight */}
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-xs leading-snug text-[var(--ff-muted)]">
                      {questionLabel(block)}
                    </p>
                    <span className={`${BADGE_MUTED} shrink-0 font-mono`}>{block.kind}</span>
                  </div>
                  <p
                    className={`mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed ${
                      empty ? "text-[var(--ff-muted)]" : "font-medium text-[var(--ff-fg)]"
                    }`}
                  >
                    {empty ? "Empty" : text}
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
    </Drawer>
  );
}
