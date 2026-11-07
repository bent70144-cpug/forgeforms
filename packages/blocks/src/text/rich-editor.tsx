// packages/blocks — `text` rich-text editor (Tiptap; follow-up #6, §9.4).
//
// §13 LAZY BOUNDARY: this is the ONLY module allowed to import @tiptap/*. It is
// loaded on demand via dynamic `import()` from ./editor.tsx, so Tiptap never
// enters the builder route's initial chunk — and because render.tsx never
// imports anything from this file, no renderer path can pull editor code (the
// ≤120 KB conversational bundle budget, spec §10.2, stays editor-free).
//
// Data flow: the editor initializes from `props.richText` (Tiptap JSON parsed
// natively; sanitized HTML strings are parsed by Tiptap's HTML reader) and
// emits Tiptap JSON upward through `onChange({ richText })` on every doc
// transaction. External prop changes (e.g. Reset to defaults) are written back
// unless they echo what this editor just emitted (that would fight the cursor).
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState, type FC } from "react";
import type { EditorProps } from "../registry";
import { type RichTextDoc, type TextProps } from "./schema";

/** UX-level href guard — the §17 sanitizer is the real render boundary. */
const UNSAFE_HREF_PATTERN = /^\s*(javascript|data|vbscript):/i;

const TOOL_BUTTON =
  "ff-rt-btn rounded border border-[color:var(--ff-border)] px-2 py-0.5 text-xs font-medium " +
  "aria-pressed:bg-[color:var(--ff-primary)] aria-pressed:text-[color:var(--ff-primary-fg)]";

/** Minimal §9.4 toolbar: bold, italic, strike, lists, link, clear formatting. */
const Toolbar: FC<{ editor: Editor; disabled?: boolean }> = ({ editor, disabled }) => {
  // v3 does not re-render on transactions by default — subscribe to the six
  // active-state booleans explicitly so aria-pressed stays truthful.
  const marks = useEditorState({
    editor,
    selector: ({ editor: ed }: { editor: Editor }) => ({
      bold: ed.isActive("bold"),
      italic: ed.isActive("italic"),
      strike: ed.isActive("strike"),
      bulletList: ed.isActive("bulletList"),
      orderedList: ed.isActive("orderedList"),
      link: ed.isActive("link"),
    }),
  });

  const [linkRowOpen, setLinkRowOpen] = useState(false);
  const [linkHrefDraft, setLinkHrefDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const chain = () => editor.chain().focus();

  const applyLink = (): void => {
    const href = linkHrefDraft.trim();
    if (href === "") {
      setLinkError("Enter a URL, or Remove the link.");
      return;
    }
    if (UNSAFE_HREF_PATTERN.test(href)) {
      setLinkError("That URL scheme is not allowed.");
      return;
    }
    // Sanitizer re-checks the href at render; safe URLs only reach it.
    chain().extendMarkRange("link").setLink({ href }).run();
    setLinkError(null);
    setLinkRowOpen(false);
  };

  return (
    <div
      className="ff-rt-toolbar flex flex-wrap items-center gap-1 pb-1"
      role="toolbar"
      aria-label="Rich text formatting"
      data-testid="ff-rt-toolbar"
    >
      <button
        type="button"
        className={TOOL_BUTTON}
        aria-pressed={marks?.bold === true}
        aria-label="Bold"
        data-testid="ff-rt-bold"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()} // keep the text selection alive
        onClick={() => chain().toggleBold().run()}
      >
        B
      </button>
      <button
        type="button"
        className={`${TOOL_BUTTON} italic`}
        aria-pressed={marks?.italic === true}
        aria-label="Italic"
        data-testid="ff-rt-italic"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().toggleItalic().run()}
      >
        I
      </button>
      <button
        type="button"
        className={`${TOOL_BUTTON} line-through`}
        aria-pressed={marks?.strike === true}
        aria-label="Strikethrough"
        data-testid="ff-rt-strike"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().toggleStrike().run()}
      >
        S
      </button>
      <button
        type="button"
        className={TOOL_BUTTON}
        aria-pressed={marks?.bulletList === true}
        aria-label="Bulleted list"
        data-testid="ff-rt-bullet-list"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().toggleBulletList().run()}
      >
        • List
      </button>
      <button
        type="button"
        className={TOOL_BUTTON}
        aria-pressed={marks?.orderedList === true}
        aria-label="Numbered list"
        data-testid="ff-rt-ordered-list"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().toggleOrderedList().run()}
      >
        1. List
      </button>
      <button
        type="button"
        className={TOOL_BUTTON}
        aria-pressed={marks?.link === true}
        aria-label="Link"
        aria-expanded={linkRowOpen}
        data-testid="ff-rt-link"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const opening = !linkRowOpen;
          setLinkRowOpen(opening);
          // Opening the row seeds it with the selection's current href so
          // editing an existing link starts from its real value.
          setLinkHrefDraft(opening ? String(editor.getAttributes("link").href ?? "") : "");
          setLinkError(null);
        }}
      >
        Link
      </button>
      <button
        type="button"
        className={TOOL_BUTTON}
        aria-label="Clear formatting"
        data-testid="ff-rt-clear"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().unsetAllMarks().clearNodes().run()}
      >
        Clear
      </button>

      {linkRowOpen && (
        <span className="ff-rt-link-row flex items-center gap-1">
          <input
            type="url"
            className="w-56 rounded border border-[color:var(--ff-border)] px-1.5 py-0.5 text-xs"
            placeholder="https://example.com"
            aria-label="Link URL"
            value={linkHrefDraft}
            data-testid="ff-rt-link-input"
            onChange={(e) => {
              setLinkHrefDraft(e.target.value);
              setLinkError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
          />
          <button
            type="button"
            className={TOOL_BUTTON}
            data-testid="ff-rt-link-apply"
            disabled={disabled}
            onClick={applyLink}
          >
            Apply
          </button>
          <button
            type="button"
            className={TOOL_BUTTON}
            aria-label="Remove link"
            data-testid="ff-rt-link-remove"
            disabled={disabled}
            onClick={() => {
              chain().extendMarkRange("link").unsetLink().run();
              setLinkHrefDraft("");
              setLinkRowOpen(false);
              setLinkError(null);
            }}
          >
            Remove
          </button>
        </span>
      )}
      {linkError && (
        <span
          className="ff-rt-link-error text-xs text-red-600"
          role="alert"
          data-testid="ff-rt-link-error"
        >
          {linkError}
        </span>
      )}
      {!linkRowOpen && marks?.link === true && (
        <span className="ff-rt-link-href text-xs text-slate-500" data-testid="ff-rt-link-href">
          {String(editor.getAttributes("link").href ?? "")}
        </span>
      )}
    </div>
  );
};

export const RichTextEditor: FC<EditorProps<TextProps>> = ({ props, onChange, disabled }) => {
  // Latest onChange — Tiptap stores options in a ref and applies the latest on
  // every render, but a stable callback keeps the emit path deterministic.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmitted = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: props.richText,
    editable: disabled !== true,
    onUpdate: ({ editor: next }) => {
      const json = next.getJSON() as RichTextDoc;
      lastEmitted.current = JSON.stringify(json);
      onChangeRef.current({ richText: json });
    },
  });

  // External richText changes (Reset to defaults, switching blocks) are written
  // into the editor — unless they merely echo the JSON this editor just
  // emitted, which would reset the caret mid-typing.
  useEffect(() => {
    if (!editor) return;
    const incoming =
      typeof props.richText === "string"
        ? `html:${props.richText}`
        : JSON.stringify(props.richText);
    if (lastEmitted.current !== null && incoming === lastEmitted.current) return;
    lastEmitted.current = null;
    editor.commands.setContent(props.richText, { emitUpdate: false });
  }, [editor, props.richText]);

  useEffect(() => {
    // emitUpdate=false: toggling editability is not a content change — the
    // builder must not receive a spurious onChange (v3 defaults emitUpdate on).
    if (editor && editor.isEditable !== (disabled !== true)) {
      editor.setEditable(disabled !== true, false);
    }
  }, [editor, disabled]);

  if (!editor) return null; // transient — useEditor resolves synchronously client-side

  return (
    <div className="ff-editor ff-editor--text" data-kind="text" data-testid="ff-text-editor">
      <Toolbar editor={editor} disabled={disabled} />
      <EditorContent
        editor={editor}
        className="ff-rt-content min-h-[6rem] rounded border border-[color:var(--ff-border)] p-2 text-sm"
        aria-label="Rich text content"
      />
    </div>
  );
};
