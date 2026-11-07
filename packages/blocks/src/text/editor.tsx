// packages/blocks — `text` builder editor registration surface (follow-up #6).
//
// §13 LAZY-LOADING: Tiptap is the first heavy editor in the registry, so the
// registered Editor is a light shell that dynamic-imports the real editor
// (`./rich-editor.tsx` — the only module importing @tiptap/*) on mount. That
// keeps Tiptap out of the builder route's initial chunk; in SSR/prerender and
// in static markup the shell renders the read-only fallback below, so the
// registry stays renderable everywhere (catalog tests use renderToStaticMarkup).
// Renderer code never touches this file at all — render.tsx is editor-free.
import { useEffect, useState, type ComponentType, type FC } from "react";
import type { EditorProps } from "../registry";
import { plainTextFromRichText, type TextProps } from "./schema";

type RichEditorComponent = ComponentType<EditorProps<TextProps>>;

export const TextEditor: FC<EditorProps<TextProps>> = (editorProps) => {
  const [RichEditor, setRichEditor] = useState<RichEditorComponent | null>(null);

  useEffect(() => {
    let alive = true;
    void import("./rich-editor").then((mod) => {
      if (alive) setRichEditor(() => mod.RichTextEditor);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (RichEditor === null) {
    // Transient chunk-load fallback (also what server markup shows). Read-only
    // on purpose: swapping in a live textarea that unmounts on chunk arrival
    // would silently eat keystrokes.
    const preview = plainTextFromRichText(editorProps.props.richText);
    return (
      <div className="ff-editor ff-editor--text" data-kind="text" data-testid="ff-text-editor-loading">
        <p className="ff-editor__muted text-sm text-slate-500">
          {preview !== "" ? preview : "Rich text editor loading…"}
        </p>
      </div>
    );
  }

  return <RichEditor {...editorProps} />;
};
