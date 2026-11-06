'use client';

// Builder context — ONE editor store instance per document, provided at the
// builder page level so every builder surface (canvas, left tree, right panel,
// top bar, dialogs) reads and dispatches through the same store (builder spec
// §8.5 "single store provider"). All builder components consume it via
// useBuilder(); nothing owns a second copy of the document state.
//
// NOTE (spec deviation, tracked for docs/builder-audit.md): the spec pins the
// provider at the d/[docId] LAYOUT level so the Logic route shares the store.
// The current LogicBuilder owns its own state (pre-existing), so the provider
// lives on the builder page only; moving it into the layout is a follow-up.

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  editorReducer,
  initialEditorState,
  type EditorAction,
  type EditorState,
} from "@/lib/builder/store";

type BuilderContextValue = {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
};

// Exported so static-render tests (vitest node env, react-dom/server) can
// seed a loaded EditorState without a DOM/Provider dispatch cycle. Production
// code must go through BuilderProvider.
export const BuilderContext = createContext<BuilderContextValue | null>(null);

export function BuilderProvider({
  docId,
  initialState,
  children,
}: {
  docId: string;
  /**
   * Test/preload seam (B3): start from a fully-built EditorState instead of
   * the empty one. Component tests use it because renderToStaticMarkup never
   * runs effects — they build the state by pure `editorReducer` calls and
   * inject it here. Production code passes nothing (normal empty start).
   */
  initialState?: EditorState;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    editorReducer,
    initialState ?? docId,
    (arg: EditorState | string) => (typeof arg === "string" ? initialEditorState(arg) : arg),
  );
  const value = useMemo<BuilderContextValue>(() => ({ state, dispatch }), [state]);
  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

export function useBuilder(): BuilderContextValue {
  const ctx = useContext(BuilderContext);
  if (!ctx) {
    throw new Error("useBuilder must be used inside <BuilderProvider> (builder page).");
  }
  return ctx;
}

/** Store state only — for components that never dispatch. */
export function useBuilderState(): EditorState {
  return useBuilder().state;
}
