// Logic editor runtime — glue between the T08 editor store (reducer, undo/
// redo, ops emit channel) and the T08 AutosaveController, for the logic
// builder page (spec §14.1.4 + §8 autosave contract).
//
// The logic page never talks to the transport directly: it dispatches rule ops
// (rule.upsert / rule.remove — spec §8 vocabulary) into the store; the emit
// channel feeds the autosave queue; the controller PATCHes
// `PATCH /api/v1/documents/:id` with `{ baseRev, ops }` and drives the
// "Saving…"/"Saved" chip (saved within 2 s of the edit, spec §14.2).
//
// Framework-free (no React) so the whole loop is testable with fake timers.

import { AutosaveController, type AutosaveStatus, type StatusInfo } from "../builder/autosave";
import {
  editorReducer,
  initialEditorState,
  type EditorAction,
  type EditorState,
} from "../builder/store";
import type { DocumentEnvelope, DocumentStatus } from "../bridge";
import type { DocumentTransport } from "../builder/transport";
import type { Op } from "../builder/ops";

export type LogicEditorSnapshot = {
  ready: boolean;
  meta: EditorState["meta"];
  body: EditorState["body"];
  docStatus: DocumentStatus;
  rev: number;
  save: AutosaveStatus;
  savedAt: number | null;
  /** Ops from the latest mutation that still must reach the server. */
  emit: EditorState["emit"];
};

export type LogicEditorRuntimeOptions = {
  transport: DocumentTransport;
  docId: string;
  envelope: DocumentEnvelope;
  /** Debounce for the autosave queue (spec §8: 500 ms). */
  debounceMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
  /** Notified after ANY state mutation (apply/undo/redo/autosave status/409). */
  onChange?: () => void;
};

export type LogicEditorRuntime = {
  snapshot(): LogicEditorSnapshot;
  /** Apply ops (e.g. rule.upsert) optimistically and queue them for autosave. */
  apply(ops: readonly Op[], label?: string): void;
  undo(): void;
  redo(): void;
  /** Flush immediately (pagehide); resolves after the current queue drains. */
  flushNow(): Promise<void>;
  destroy(): void;
};

export function createLogicEditorRuntime(options: LogicEditorRuntimeOptions): LogicEditorRuntime {
  const { transport, docId, envelope, onChange } = options;
  const schedule = options.schedule ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  });
  const now = options.now ?? (() => Date.now());
  const notify = (): void => onChange?.();

  let state: EditorState = editorReducer(
    initialEditorState(docId),
    { type: "loaded", envelope, mode: "api" },
  );

  const controller = new AutosaveController({
    transport,
    docId,
    initialRev: envelope.rev,
    debounceMs: options.debounceMs,
    schedule,
    now,
    onStatus: (status: AutosaveStatus, _info: StatusInfo) => {
      state = editorReducer(state, { type: "saveStatus", status, at: now() });
      notify();
    },
    onAck: (rev: number) => {
      state = editorReducer(state, { type: "ackRev", rev });
      notify();
    },
    onReconciled: (doc, rev) => {
      state = editorReducer(state, { type: "reconciled", doc, rev });
      notify();
    },
  });

  const runtime: LogicEditorRuntime = {
    snapshot: () => ({
      ready: state.ready,
      meta: state.meta,
      body: state.body,
      docStatus: state.docStatus,
      rev: state.rev,
      save: state.save,
      savedAt: state.savedAt,
      emit: state.emit,
    }),
    apply(ops, label) {
      state = editorReducer(state, { type: "apply", ops: [...ops], label });
      // Every mutation produces a fresh emit; enqueue it immediately — the
      // autosave queue serializes + debounces (spec §8), so nothing is lost.
      if (state.emit) controller.enqueue(state.emit.ops);
      notify();
    },
    undo() {
      state = editorReducer(state, { type: "undo" });
      if (state.emit) controller.enqueue(state.emit.ops);
      notify();
    },
    redo() {
      state = editorReducer(state, { type: "redo" });
      if (state.emit) controller.enqueue(state.emit.ops);
      notify();
    },
    flushNow: () => controller.flushNow(),
    destroy: () => controller.destroy(),
  };

  return runtime;
}
