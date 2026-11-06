"use client";

// Logic builder screen (spec §14.1.4, `/d/:docId/logic`): React Flow canvas +
// rule drawer + flow preview + autosave with the Saved chip (spec §8/§14.2).
//
// Data flows through the T08 seams: DocumentTransport (Api → real documents
// API; Mock fallback for offline dev via NEXT_PUBLIC_FF_MOCK_BUILDER=1),
// editor store + AutosaveController via lib/logic/editor.ts, and ops vocabulary
// rule.upsert / rule.remove / block.update / settings.update (spec §8).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTransport } from "@/lib/builder/transport";
import { buildLogicGraph, endingNodeId, START_NODE_ID } from "@/lib/logic/graph";
import { createLogicEditorRuntime, type LogicEditorRuntime, type LogicEditorSnapshot } from "@/lib/logic/editor";
import { LogicCanvas } from "./LogicCanvas";
import { RuleDrawer, type ScopeInfo } from "./RuleDrawer";
import { FlowPreview } from "./FlowPreview";

export function LogicBuilder({ docId }: { docId: string }) {
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
        targets.push({ id: endingNodeId(n.endingId), label: `🏁 ${n.label}` });
      }
    }
    return targets;
  }, [graph.nodes]);

  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-6 text-sm">
        <p className="font-semibold text-[var(--ff-fg)]">Logic builder could not load</p>
        <p className="mt-1 leading-relaxed text-[var(--ff-muted)]">{error}</p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--ff-muted)]">
          The documents API (T07) is not wired in this branch yet — set
          NEXT_PUBLIC_FF_MOCK_BUILDER=1 for the in-memory dev document.
        </p>
      </div>
    );
  }

  if (!runtime || !snapshot) {
    return (
      <div className="p-6 text-sm text-[var(--ff-muted)]" aria-live="polite">
        Loading logic builder…
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100vh-8rem)] flex-col gap-3 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-[var(--ff-fg)]">Logic</h1>
          <a
            href={`/d/${docId}/results`}
            className="text-xs font-medium text-[var(--ff-primary)] hover:underline"
          >
            Results →
          </a>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/d/${docId}`}
            className="text-xs font-medium text-[var(--ff-muted)] transition-colors hover:text-[var(--ff-fg)] hover:underline"
          >
            ← Builder
          </a>
          <SaveChip save={snapshot.save} />
        </div>
      </header>

      <div className="relative min-h-0 flex-1 rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)]">
        <LogicCanvas graph={graph} selectedId={openScope} onSelect={setOpenScope} />
        {scopeInfo && (
          <RuleDrawer
            scope={scopeInfo}
            body={snapshot.body}
            targets={gotoTargets}
            onApply={apply}
            onClose={() => setOpenScope(null)}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <FlowPreview body={snapshot.body} />
        <div className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-4">
          <p className="text-sm leading-relaxed text-[var(--ff-muted)]">
            <strong className="font-semibold text-[var(--ff-fg)]">How it works:</strong> nodes follow
            document order (default flow); dashed edges are rule <code>goto</code>s. Click Start or a
            question to add rules — IF conditions are AND-ed, THEN runs goto/set, and “in all other
            cases” is the fallback. Rule edits autosave via <code>PATCH /api/v1/documents/:id</code> ops.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-md border border-[var(--ff-border)] px-2.5 py-1 text-sm font-medium text-[var(--ff-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)]"
              onClick={() => runtime.undo()}
            >
              Undo
            </button>
            <button
              type="button"
              className="rounded-md border border-[var(--ff-border)] px-2.5 py-1 text-sm font-medium text-[var(--ff-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)]"
              onClick={() => runtime.redo()}
            >
              Redo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveChip({ save }: { save: LogicEditorSnapshot["save"] }) {
  const chip =
    save === "saved"
      ? "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : save === "saving" || save === "dirty"
        ? "border-transparent bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
        : save === "error" || save === "conflict"
          ? "border-transparent bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
          : "border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)] text-[var(--ff-muted)]";
  const label =
    save === "saved"
      ? "Saved"
      : save === "saving"
        ? "Saving…"
        : save === "dirty"
          ? "Unsaved changes"
          : save === "conflict"
            ? "Conflict — merging"
            : save === "error"
              ? "Save failed"
              : "—";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${chip}`}
      data-testid="save-chip"
      aria-live="polite"
    >
      {label}
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
