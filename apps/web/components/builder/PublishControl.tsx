'use client';

// PublishControl — the §4 Publish button state machine + §7.5 draft-vs-
// published chip, replacing the wave-1 stub. Mounted by TopBar (read-only
// there); everything below lives in this file so TopBar stays untouched.
//
// Button states (§4), derived by lib/builder/publish.publishButtonState:
// - `Publish`      → enabled; click runs the local publish gate (§8.1): any
//                    blocking issue opens the IssuesList instead of POSTing.
// - `Publishing…`  → in-flight, disabled, ◌ spinner character.
// - `Published ✓`  → disabled + adjacent "Live — view" link (/p/<slug>).
// - `Fix N issues` → N blocking issues; opens the IssuesList.
//
// Publish flow (§22.1): POST /api/v1/documents/:id/publish { expectedRev }.
// - 200 → dispatch docStatus "published", swap to Published ✓ + Live link.
// - 409 → dispatch the `ff:force-save` window event (autosave flush contract,
//         wave 1/3) and surface "Saving your changes — try again".
// - 422 { issues } → merge the server issues into the drawer and open it.
//
// Draft-vs-published (§7.5): the amber "Unpublished changes" chip shows when
// the save state is pending (dirty/saving/offline/error/conflict) or any
// validation issues exist; the one-time hint under the button states that
// edits are saved as a draft until published again.

import { useCallback, useMemo, useState } from "react";
import { useBuilder } from "./context";
import { IssuesList } from "./IssuesList";
import { BUILDER_EVENTS, emitPlanLimit } from "@/lib/builder/canvas-ops";
import { blockDisplayLabel } from "@/lib/builder/blockMeta";
import { findBlock } from "@/lib/builder/ops";
import { BTN_DESTRUCTIVE, BTN_PRIMARY } from "@/lib/ui";
import {
  collectIssues,
  hasUnpublishedChanges,
  mergeIssues,
  publishButtonState,
  publishDocument,
  type ValidationIssue,
} from "@/lib/builder/publish";
import { track } from "@/lib/telemetry";

/** §7.5: "state this in the UI once". */
const DRAFT_HINT = "Edits are saved as a draft. Publish to update the live form.";

export function PublishControl() {
  const { state, dispatch } = useBuilder();

  // §8.1: memoized on the body — recomputed only when the document changes.
  // Field/block validation NEVER blocks autosave; this is display + gate only.
  const issues = useMemo(() => collectIssues(state.body), [state.body]);

  const [publishing, setPublishing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Server issues from the last 422 (merged with the local list). */
  const [serverIssues, setServerIssues] = useState<ValidationIssue[] | null>(null);
  const [conflictNote, setConflictNote] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Live URL from the publish response; falls back to /p/<slug>. */
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  /** The §7.5 hint shows once — until this session's first publish succeeds. */
  const [everPublished, setEverPublished] = useState(false);

  const btnState = publishButtonState({
    docStatus: state.docStatus,
    save: state.save,
    issues,
    publishing,
  });

  const displayIssues = serverIssues !== null ? mergeIssues(issues, serverIssues) : issues;
  const blocking = displayIssues.filter((issue) => issue.level === "error").length;
  const chipVisible = hasUnpublishedChanges(state.save, displayIssues);
  const liveHref = liveUrl ?? `/p/${state.meta.slug ?? state.docId}`;

  const goTo = useCallback(
    (blockId: string) => {
      dispatch({ type: "select", id: blockId });
      dispatch({ type: "setPanel", panel: "block" });
      // WAVE-3 CONTRACT (now wired): the canvas listens for `ff:goto-block`
      // (detail: { id }) to scroll the block into view + flash it.
      window.dispatchEvent(new CustomEvent(BUILDER_EVENTS.gotoBlock, { detail: { id: blockId } }));
    },
    [dispatch],
  );

  const labelFor = useCallback(
    (blockId: string) => {
      const found = findBlock(state.body.blocks, blockId);
      return found ? blockDisplayLabel(found.block) : undefined;
    },
    [state.body.blocks],
  );

  const onPublish = async () => {
    setConflictNote(false);
    setErrorMessage(null);
    // §15 publish_attempt: one event per click with the BLOCKING issue count
    // (0 = a real publish POST follows; >0 = gated locally by the §8.1 list).
    track("publish_attempt", { issues: blocking });
    // Flush semantics: gate locally first — blocking issues open the list.
    if (blocking > 0) {
      setDrawerOpen(true);
      return;
    }
    setPublishing(true);
    try {
      const result = await publishDocument(state.docId, state.rev);
      if (result.ok) {
        setEverPublished(true);
        setServerIssues(null);
        setDrawerOpen(false);
        setLiveUrl(result.url ?? null);
        dispatch({ type: "docStatus", status: "published" });
        track("publish_ok");
      } else if (result.reason === "conflict") {
        // §22.1: "409 → flush pending ops first". The autosave controller
        // (wave 1/3) listens for this window event; keep the note until the
        // retry succeeds or the user edits again.
        window.dispatchEvent(new CustomEvent("ff:force-save"));
        setConflictNote(true);
      } else if (result.reason === "validation") {
        setServerIssues(result.issues);
        setDrawerOpen(true);
      } else if (result.reason === "plan-limit") {
        // §14 (follow-up #8): 402/403 is an inline plan-limit explanation in
        // the SHELL notice (same mechanism as the 422 rollback notice) —
        // never a dead-end error. PublishControl only emits the event; the
        // builder page owns the notice state.
        emitPlanLimit({
          status: result.status,
          message: result.message,
          capability: result.capability,
        });
      } else {
        setErrorMessage(result.message);
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex flex-col items-end" data-testid="publish-control">
      <div className="flex items-center gap-1.5 sm:gap-2">
        {chipVisible && (
          <span
            className="ff-pub-chip"
            title={DRAFT_HINT}
            data-testid="unpublished-chip"
            style={{
              borderColor: "color-mix(in srgb, var(--ff-warning) 30%, transparent)",
              background: "var(--ff-warning-soft)",
              color: "var(--ff-warning)",
            }}
          >
            Unpublished changes
          </span>
        )}

        {btnState === "publishing" ? (
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled
            aria-live="polite"
            data-testid="publish-button"
            data-state="publishing"
          >
            <span aria-hidden="true">◌</span> Publishing…
          </button>
        ) : btnState === "published" ? (
          <>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled
              data-testid="publish-button"
              data-state="published"
              title="The live form is up to date"
            >
              Published ✓
            </button>
            <span
              className="hidden text-xs text-[color:var(--ff-muted)] sm:inline sm:max-w-44 sm:truncate"
              style={{ fontFamily: "var(--ff-font-mono)" }}
              title={liveHref}
              data-testid="publish-live-url"
            >
              {liveHref}
            </span>
            <a
              href={liveHref}
              className="ff-icon-btn"
              data-testid="publish-live-link"
              aria-label="Live — view the published form"
              title="Live — view"
            >
              Live — view
            </a>
            <button
              type="button"
              className="ff-icon-btn"
              aria-label="Copy live form URL"
              title="Copy live URL"
              data-testid="publish-copy-link"
              onClick={() => {
                try {
                  void navigator.clipboard?.writeText(liveHref);
                } catch {
                  // Clipboard permission denied / insecure context — best effort.
                }
              }}
            >
              <span aria-hidden="true">⧉</span>
            </button>
          </>
        ) : btnState === "fix-issues" ? (
          <button
            type="button"
            className={BTN_DESTRUCTIVE}
            onClick={onPublish}
            data-testid="publish-button"
            data-state="fix-issues"
            title="Fix the issues before publishing"
          >
            Fix {blocking} {blocking === 1 ? "issue" : "issues"}
          </button>
        ) : (
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={onPublish}
            data-testid="publish-button"
            data-state="publish"
            title="Publish this form to the public URL"
          >
            Publish
          </button>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="ff-pub-error" style={{ color: "var(--ff-danger)" }}>
          {errorMessage}
        </p>
      )}
      {conflictNote && (
        <p role="status" className="ff-pub-note" style={{ color: "var(--ff-warning)" }}>
          Saving your changes — try again
        </p>
      )}
      {!everPublished && state.docStatus !== "published" && <p className="ff-pub-hint">{DRAFT_HINT}</p>}

      <IssuesList
        open={drawerOpen}
        issues={displayIssues}
        onClose={() => setDrawerOpen(false)}
        goTo={goTo}
        labelFor={labelFor}
      />
    </div>
  );
}
