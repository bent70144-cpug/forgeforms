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

const BuilderContext = createContext<BuilderContextValue | null>(null);

export function BuilderProvider({
  docId,
  children,
}: {
  docId: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, docId, initialEditorState);
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
