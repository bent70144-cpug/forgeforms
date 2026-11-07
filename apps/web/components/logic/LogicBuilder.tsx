"use client";

// Logic builder screen (spec §14.1.4, `/d/:docId/logic`): React Flow canvas +
// rule drawer + flow preview + autosave with the Saved chip (spec §8/§14.2).
//
// Data flows through the T08 seams: DocumentTransport (Api → real documents
// API; Mock fallback for offline dev via NEXT_PUBLIC_FF_MOCK_BUILDER=1),
// editor store + AutosaveController via lib/logic/editor.ts, and ops vocabulary
// rule.upsert / rule.remove / block.update / settings.update (spec §8).
//
// Redesign (B7): header chrome (Dashboard/Results links) is passed in from the
// server page as RSC slots; the save chip reuses the shared .ff-save-chip
// recipe from components/builder/save-indicator (the store seam itself lives
// behind the runtime, which this page doesn't own); toolbar shows question +
// lint summary; the state machine (rules, undo/redo, autosave) is untouched.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createTransport } from "@/lib/builder/transport";
import type { AutosaveStatus } from "@/lib/builder/autosave";
import {
  BADGE_MUTED,
  BADGE_POSITIVE,
  BADGE_WARNING,
  BTN_PRIMARY_SM,
  BTN_SECONDARY_SM,
  CARD,
} from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
import {
  buildLogicGraph,
  endingNodeId,
  logicLintErrors,
  START_NODE_ID,
} from "@/lib/logic/graph";
import {
  createLogicEditorRuntime,
  type LogicEditorRuntime,
  type LogicEditorSnapshot,
} from "@/lib/logic/editor";
import { LogicCanvas } from "./LogicCanvas";
import { RuleDrawer, type ScopeInfo } from "./RuleDrawer";
import { FlowPreview } from "./FlowPreview";

export type LogicBuilderProps = {
  docId: string;
  /** Server-rendered back link (header slot, left). */
  backLink?: ReactNode;
  /** Server-rendered Results link (header slot, right). */
  resultsLink?: ReactNode;
};

export function LogicBuilder({ docId, backLink, resultsLink }: LogicBuilderProps) {
  const [snapshot, setSnapshot] = useState<LogicEditorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<LogicEditorRuntime | null>(null);
  const [openScope, setOpenScope] = useState<string | null>(null);
  const runtimeRef = useRef<LogicEditorRuntime | null>(null);

  // Load the document and start the autosave loop.
  useEffect(() => {
    let disposed = false;
    const transport = createTransport();
    void (async () => {
      try {
        const envelope = await transport.load(docId);
        if (disposed) return;
        const rt = createLogicEditorRuntime({
          transport,
          docId,
          envelope,
          onChange: () => setSnapshot(rt.snapshot()),
        });
        runtimeRef.current = rt;
        setRuntime(rt);
        setSnapshot(rt.snapshot());
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : "Could not load the document");
        }
      }
    })();
    return () => {
      disposed = true;
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
  }, [docId]);

  // Zero data loss on reload (spec §14.2): flush on page hide.
  useEffect(() => {
    const onHide = (): void => {
      void runtime?.flushNow();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [runtime]);

  const apply = useCallback(
    (ops: Parameters<LogicEditorRuntime["apply"]>[0]) => runtime?.apply(ops),
    [runtime],
  );

  const graph = useMemo(
    () => buildLogicGraph(snapshot?.body ?? emptyFallback()),
    [snapshot?.body],
  );

  const scopeInfo = useMemo<ScopeInfo | null>(() => {
    if (openScope === null) return null;
    if (openScope === START_NODE_ID) return { id: START_NODE_ID, kind: "start", label: "Start" };
    const question = graph.nodes.find((n) => n.id === openScope && n.kind === "question");
    if (question) {
      return { id: question.id, kind: "question", label: question.label, questionKind: question.questionKind };
    }
    const ending = graph.nodes.find((n) => n.id === openScope && n.kind === "ending");
    if (ending) return { id: ending.id, kind: "ending", label: ending.label, endingId: ending.endingId };
    return null;
  }, [openScope, graph.nodes]);

  const gotoTargets = useMemo(() => {
    const targets = graph.nodes
      .filter((n) => n.kind === "question")
      .map((n) => ({ id: n.id, label: n.label }));
    for (const n of graph.nodes) {
      if (n.kind === "ending" && n.endingId !== undefined) {
        targets.push({ id: endingNodeId(n.endingId), label: n.label });
      }
    }
    return targets;
  }, [graph.nodes]);

  // Toolbar summaries — derived display state only (same pure helpers the
  // FlowPreview uses); no state-machine changes.
  const questionCount = useMemo(
    () => graph.nodes.filter((n) => n.kind === "question").length,
    [graph.nodes],
  );
  const lintErrors = useMemo(() => logicLintErrors(snapshot?.body ?? emptyFallback()), [snapshot?.body]);

  const canEdit = runtime !== null && snapshot !== null;

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[72rem] px-1 py-6 md:px-0">
        <div className={`${CARD} mx-auto max-w-md p-6`}>
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ff-fg)]">
            <Icon name="alert" size={16} className="text-[var(--ff-danger)]" />
            Logic builder could not load
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">{error}</p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--ff-muted)]">
            The documents API (T07) is not wired in this branch yet — set
            NEXT_PUBLIC_FF_MOCK_BUILDER=1 for the in-memory dev document.
          </p>
        </div>
      </div>
    );
  }

  return (
    // R3 mobile: the fixed 100dvh height (incl. the stacked preview/help grid)
    // only applies from lg up; below it the flow is auto-height and the canvas
    // gets its own 24rem so the phone layout doesn't squeeze it to a sliver.
    <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-3 lg:h-[calc(100dvh-9.5rem)] lg:min-h-[32rem]">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {backLink}
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--ff-fg)]">Logic</h1>
            {snapshot && snapshot.meta.title !== "" && (
              <span className="truncate text-sm text-[var(--ff-muted)]" title={snapshot.meta.title}>
                {snapshot.meta.title}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {snapshot && <SaveChip save={snapshot.save} />}
          {resultsLink}
        </div>
      </header>

      {!canEdit ? (
        <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
          <p className="sr-only">Loading logic builder…</p>
          <div className="ff-skeleton h-24! w-full" />
          <div className="ff-skeleton h-64! w-full" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={BADGE_MUTED}>
                {questionCount} {questionCount === 1 ? "question" : "questions"}
              </span>
              {lintErrors.length > 0 ? (
                <span className={BADGE_WARNING} data-testid="lint-summary">
                  <Icon name="alert" size={12} />
                  {lintErrors.length} {lintErrors.length === 1 ? "issue" : "issues"}
                </span>
              ) : (
                <span className={BADGE_POSITIVE} data-testid="lint-summary">
                  <Icon name="check" size={12} />
                  No issues
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`${BTN_SECONDARY_SM} disabled:cursor-not-allowed! disabled:opacity-40!`}
                onClick={() => runtime?.undo()}
                disabled={!runtime}
              >
                <Icon name="arrowLeft" size={14} />
                Undo
              </button>
              <button
                type="button"
                className={`${BTN_SECONDARY_SM} disabled:cursor-not-allowed! disabled:opacity-40!`}
                onClick={() => runtime?.redo()}
                disabled={!runtime}
              >
                Redo
                <Icon name="arrowRight" size={14} />
              </button>
              <button
                type="button"
                className={BTN_PRIMARY_SM}
                onClick={() => setOpenScope(START_NODE_ID)}
              >
                <Icon name="flow" size={14} />
                Edit rules
              </button>
            </div>
          </div>

          <div className={`${CARD} relative h-[24rem] overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1`}>
            <LogicCanvas graph={graph} selectedId={openScope} onSelect={setOpenScope} />
          </div>

          {scopeInfo && (
            <RuleDrawer
              scope={scopeInfo}
              body={snapshot.body}
              targets={gotoTargets}
              onApply={apply}
              onClose={() => setOpenScope(null)}
            />
          )}

          <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <FlowPreview body={snapshot.body} />
            <section className={`${CARD} p-5`} aria-label="How the logic builder works">
              <p className="text-sm leading-relaxed text-[var(--ff-muted)]">
                <strong className="font-medium text-[var(--ff-fg)]">How it works:</strong> nodes follow
                document order (default flow); dashed edges are rule{" "}
                <code className="rounded bg-[color-mix(in_srgb,var(--ff-fg)_8%,transparent)] px-1 font-mono text-xs">
                  goto
                </code>
                s. Click Start or a question to add rules — IF conditions are AND-ed, THEN runs
                goto/set, and “in all other cases” is the fallback. Rule edits autosave via{" "}
                <code className="rounded bg-[color-mix(in_srgb,var(--ff-fg)_8%,transparent)] px-1 font-mono text-xs">
                  PATCH /api/v1/documents/:id
                </code>{" "}
                ops.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={`${BTN_SECONDARY_SM} disabled:cursor-not-allowed! disabled:opacity-40!`}
                  onClick={() => runtime?.undo()}
                  disabled={!runtime}
                >
                  <Icon name="arrowLeft" size={14} />
                  Undo
                </button>
                <button
                  type="button"
                  className={`${BTN_SECONDARY_SM} disabled:cursor-not-allowed! disabled:opacity-40!`}
                  onClick={() => runtime?.redo()}
                  disabled={!runtime}
                >
                  Redo
                  <Icon name="arrowRight" size={14} />
                </button>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// Same visual recipe as components/builder/save-indicator's <SaveIndicator>
// (.ff-save-chip). The store seam behind that component is fed by the
// AutosaveController inside the logic runtime (not owned here), so this chip
// renders the runtime's `save` status directly with the shared classes.
const SAVE_CHIP_LABELS: Record<AutosaveStatus, string> = {
  idle: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  conflict: "Conflict — recovering…",
  error: "Save failed",
  // §7.1 follow-ups: keep the queue calm — same copy as the shared
  // save-indicator recipe (offline is never an error; unauthenticated asks
  // for re-auth).
  offline: "Offline — changes kept",
  unauthenticated: "Sign-in required",
};

function SaveChip({ save }: { save: AutosaveStatus }) {
  const tone =
    save === "error" || save === "conflict" || save === "unauthenticated"
      ? "error"
      : save === "saved" || save === "idle"
        ? "ok"
        : "";
  return (
    <span
      className={`ff-save-chip${tone === "" ? "" : ` ff-save-chip--${tone}`}`}
      data-testid="save-chip"
      role="status"
      aria-live="polite"
    >
      {SAVE_CHIP_LABELS[save]}
    </span>
  );
}

function emptyFallback(): LogicEditorSnapshot["body"] {
  // Pre-load placeholder — replaced as soon as the envelope arrives.
  return {
    schemaVersion: 1,
    type: "form",
    theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
    settings: {
      seo: {},
      locale: "en",
      progressBar: true,
      autoAdvance: true,
      showBranding: true,
      captcha: false,
      notifyEmails: [],
    },
    blocks: [],
    endings: [],
    logic: { rules: [] },
  };
}
