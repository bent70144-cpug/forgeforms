'use client';

// IssuesList — the §8.1 document-level validation drawer ("opens an Issues
// list grouped by block with 'Go to' buttons"). Rendered by PublishControl.
//
// Structure: fixed right slide-over (~360px) over a dimmed backdrop, role=
// "dialog", Esc + backdrop close, focus moves into the list when it opens.
// Groups come from lib/builder/publish.groupIssues (document-level group
// first); each issue shows its stable §8.1 code chip, the human message and,
// for block-scoped issues, a "Go to" button.
//
// ---------------------------------------------------------------------------
// WINDOW EVENT CONTRACT (emitted here; consumer = canvas, wired in wave 3)
// ---------------------------------------------------------------------------
// "ff:goto-block"  CustomEvent<{ id: string }> on window — the canvas scrolls
// the block into view and flashes it. Dispatching it today is a safe no-op;
// the store `select` + `setPanel("block")` already work without it.
//
// Warning-class issues (SENSITIVE_FIELD, §8.1 "warning, not blocking") are
// styled amber and carry the abuse-policy note; they never block publishing.

import { useEffect, useRef } from "react";
import {
  ABUSE_POLICY_NOTE,
  groupIssues,
  type ValidationIssue,
} from "@/lib/builder/publish";

export type IssuesListProps = {
  open: boolean;
  issues: readonly ValidationIssue[];
  onClose: () => void;
  /** Select the block in the store + fire `ff:goto-block` (see contract above). */
  goTo: (blockId: string) => void;
  /** Block id → display label (falls back to "Block <id>"). */
  labelFor?: (blockId: string) => string | undefined;
};

/** Count line for the aria-live region (§14.4 screen-reader feedback). */
export function issuesSummary(issues: readonly ValidationIssue[]): string {
  const blocking = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.length - blocking;
  if (issues.length === 0) return "No issues — ready to publish.";
  const parts: string[] = [`${blocking} blocking ${blocking === 1 ? "issue" : "issues"}`];
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export function IssuesList({ open, issues, onClose, goTo, labelFor }: IssuesListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Focus into the list + Esc-to-close for the lifetime of the drawer.
  // (Static-render tests never run effects — they assert markup only.)
  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups = groupIssues(issues, labelFor);

  return (
    <div className="ff-pub-overlay" data-testid="issues-overlay">
      {/* Backdrop: click-to-close (a button keeps it keyboard/touch friendly). */}
      <button
        type="button"
        className="ff-pub-backdrop"
        aria-label="Close publish issues"
        onClick={onClose}
        tabIndex={-1}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Publish issues"
        data-testid="issues-drawer"
        className="ff-pub-drawer"
      >
        <header className="ff-pub-drawer-head">
          <h2 className="ff-pub-drawer-title">Publish issues</h2>
          <button type="button" className="ff-icon-btn" aria-label="Close publish issues" onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <p className="ff-pub-count" aria-live="polite" data-testid="issues-count">
          {issuesSummary(issues)}
        </p>

        <div ref={listRef} tabIndex={-1} className="ff-pub-list">
          {groups.length === 0 ? (
            <p className="ff-pub-empty">No issues — ready to publish.</p>
          ) : (
            groups.map((group) => (
              <section key={group.blockId ?? "document"} className="ff-pub-group" aria-label={group.label}>
                <h3 className="ff-pub-group-label">
                  {group.label}
                  <span className="ff-pub-group-count">{group.issues.length}</span>
                </h3>
                <ul className="ff-pub-group-list">
                  {group.issues.map((issue, index) => {
                    const warning = issue.level === "warning";
                    return (
                      <li
                        key={`${issue.code}-${issue.path ?? index}`}
                        className={warning ? "ff-pub-issue ff-pub-issue--warning" : "ff-pub-issue"}
                      >
                        <span className="ff-pub-code" data-code={issue.code}>
                          {issue.code}
                        </span>
                        <p className="ff-pub-msg">{issue.message}</p>
                        {warning && <p className="ff-pub-abuse">{ABUSE_POLICY_NOTE}</p>}
                        {issue.blockId !== null && (
                          <button
                            type="button"
                            className="ff-pub-goto"
                            onClick={() => {
                              goTo(issue.blockId as string);
                              onClose();
                            }}
                          >
                            Go to
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
