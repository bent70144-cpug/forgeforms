// Editor state reducer — wires the document (ops reducer), undo/redo history,
// selection, save status and the ops "emit" channel that feeds AutosaveController.
//
// SPEC-NOTE: spec §1 pins Zustand+Immer for editor state. Per the ticket's
// zero-dependency policy this is a plain React useReducer with the same shape;
// the reducer is pure and portable to a zustand store unchanged if the team
// later adopts the pinned stack.

import type { DocumentEnvelope, DocumentStatus } from "../bridge";
import { mergeCoalescedEntry } from "./coalesce";
import { emptyHistory, popRedo, popUndo, pushEntry, type History } from "./history";
import { applyOps, invertOps, findBlock, emptyBody, type EditableDoc, type Op, type DocMeta } from "./ops";

export type PanelTab = "block" | "document" | "theme" | "endings";
// "offline" mirrors AutosaveStatus (§7.1: edits continue, queue kept) — added
// when AutosaveController gained the offline state so the store can carry it.
// "unauthenticated" mirrors the §7.1 follow-up #3 re-auth park (session
// expired — queue parked, edits keep collecting).
export type SaveStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "conflict"
  | "error"
  | "offline"
  | "unauthenticated";

export type EditorState = {
  docId: string;
  ready: boolean;
  mode: "api" | "mock" | null;
  meta: DocMeta;
  body: DocumentEnvelope["body"];
  docStatus: DocumentStatus;
  rev: number;
  selection: string | null;
  panel: PanelTab;
  history: History;
  save: SaveStatus;
  savedAt: number | null;
  /** Ops from the latest mutation that must still reach the server. */
  emit: { nonce: number; ops: Op[] } | null;
  emitNonce: number;
};

export type EditorAction =
  | { type: "loaded"; envelope: DocumentEnvelope; mode: "api" | "mock" }
  | {
      type: "apply";
      ops: readonly Op[];
      label?: string;
      /**
       * Group id for grouped undo (spec §6.3, §11): entries sharing a group are
       * undone/redone as ONE step (e.g. an AI multi-op apply batch).
       */
      group?: string;
      /**
       * Coalescing hint (spec §3.3): dispatches with the same `key` within
       * COALESCE_WINDOW_MS merge into the last history entry AND into one
       * outgoing op. Typing uses `update:<blockId>`; the timestamp `at` comes
       * from the caller (injectable clock — the reducer never calls Date.now).
       */
      coalesce?: { key: string; at: number };
    }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "emitDone"; nonce: number }
  | { type: "saveStatus"; status: SaveStatus; at?: number }
  | { type: "ackRev"; rev: number }
  | { type: "reconciled"; doc: EditableDoc; rev: number }
  | { type: "replaceFromServer"; envelope: DocumentEnvelope }
  | { type: "select"; id: string | null }
  | { type: "setPanel"; panel: PanelTab }
  | { type: "docStatus"; status: DocumentStatus };

export function initialEditorState(docId: string): EditorState {
  return {
    docId,
    ready: false,
    mode: null,
    meta: { title: "" },
    body: emptyBody("form"),
    docStatus: "draft",
    rev: 0,
    selection: null,
    panel: "document",
    history: emptyHistory(),
    save: "idle",
    savedAt: null,
    emit: null,
    emitNonce: 0,
  };
}

function withEmit(state: EditorState, ops: readonly Op[]): EditorState {
  return {
    ...state,
    emit: { nonce: state.emitNonce + 1, ops: [...ops] },
    emitNonce: state.emitNonce + 1,
  };
}

function pruneSelection(state: EditorState, body: EditorState["body"]): EditorState {
  if (state.selection && !findBlock(body.blocks, state.selection)) {
    return { ...state, selection: null, panel: state.panel === "block" ? "document" : state.panel };
  }
  return state;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        ready: true,
        mode: action.mode,
        meta: { title: action.envelope.title, slug: action.envelope.slug },
        body: action.envelope.body,
        docStatus: action.envelope.status,
        rev: action.envelope.rev,
        history: emptyHistory(),
        selection: null,
      };

    case "apply": {
      const doc: EditableDoc = { meta: state.meta, body: state.body };
      let next: EditableDoc;
      try {
        next = applyOps(doc, action.ops);
      } catch {
        // Invalid op (e.g. stale selection): ignore client-side; the server
        // would answer 422 anyway.
        return state;
      }
      const inverse = invertOps(doc, action.ops);

      // §3.3 coalescing: same-key dispatch within the window merges into the
      // last history entry and into ONE outgoing op (typing = `update:<id>`;
      // keyboard moves = `move:<id>`). Only consecutive edits coalesce — the
      // redo stack must be empty (mergeCoalescedEntry clears it either way).
      if (action.coalesce && action.ops.length === 1 && state.history.future.length === 0) {
        const merged = mergeCoalescedEntry(state.history, {
          key: action.coalesce.key,
          at: action.coalesce.at,
          op: action.ops[0] as Op,
          inverse: inverse[0],
          label: action.label,
        });
        if (merged) {
          return withEmit(
            {
              ...state,
              meta: next.meta,
              body: next.body,
              history: merged.history,
            },
            merged.ops,
          );
        }
      }

      return withEmit(
        {
          ...state,
          meta: next.meta,
          body: next.body,
          history: pushEntry(state.history, {
            label: action.label,
            group: action.group,
            coalesceKey: action.coalesce?.key,
            coalesceAt: action.coalesce?.at,
            ops: [...action.ops],
            inverse,
          }),
        },
        action.ops,
      );
    }

    case "undo": {
      const step = popUndo(state.history);
      if (!step) return state;
      const doc: EditableDoc = { meta: state.meta, body: state.body };
      try {
        const next = applyOps(doc, step.entry.inverse);
        return withEmit(
          {
            ...state,
            meta: next.meta,
            body: next.body,
            history: step.history,
          },
          step.entry.inverse,
        );
      } catch {
        // Inverse no longer applies (doc drifted) — skip the entry.
        return { ...state, history: step.history };
      }
    }

    case "redo": {
      const step = popRedo(state.history);
      if (!step) return state;
      const doc: EditableDoc = { meta: state.meta, body: state.body };
      try {
        const next = applyOps(doc, step.entry.ops);
        return withEmit(
          {
            ...state,
            meta: next.meta,
            body: next.body,
            history: step.history,
          },
          step.entry.ops,
        );
      } catch {
        return { ...state, history: step.history };
      }
    }

    case "emitDone":
      return state.emit?.nonce === action.nonce ? { ...state, emit: null } : state;

    case "saveStatus":
      return {
        ...state,
        save: action.status,
        savedAt: action.status === "saved" ? (action.at ?? Date.now()) : state.savedAt,
      };

    case "ackRev":
      return { ...state, rev: action.rev };

    case "reconciled": {
      const merged: EditorState = {
        ...state,
        meta: action.doc.meta,
        body: action.doc.body,
        rev: action.rev,
        // History references pre-conflict states; safest to reset it.
        history: emptyHistory(),
      };
      return pruneSelection({ ...merged, save: "saved" }, action.doc.body);
    }

    case "replaceFromServer":
      return pruneSelection(
        {
          ...state,
          ready: true,
          meta: { title: action.envelope.title, slug: action.envelope.slug },
          body: action.envelope.body,
          docStatus: action.envelope.status,
          rev: action.envelope.rev,
          history: emptyHistory(),
          save: "saved",
        },
        action.envelope.body,
      );

    case "select": {
      if (action.id === null) return { ...state, selection: null };
      return findBlock(state.body.blocks, action.id)
        ? { ...state, selection: action.id, panel: "block" }
        : state;
    }

    case "setPanel":
      return { ...state, panel: action.panel };

    case "docStatus":
      return { ...state, docStatus: action.status };

    default: {
      const exhaustive: never = action;
      void exhaustive;
      return state;
    }
  }
}

/** The currently selected block, if any. */
export function selectedBlock(state: EditorState) {
  return state.selection ? findBlock(state.body.blocks, state.selection) : null;
}
