// Follow-up #6 — `text` editor interaction tests (§9.4 toolbar actions).
//
// jsdom + real Tiptap: the toolbar buttons run real ProseMirror commands, so
// every assertion below proves the editor emits schema-valid Tiptap JSON for
// each of the §9.4 minimal actions (bold, italic, strike, bullet list, ordered
// list, link, clear formatting). Selection is driven through Tiptap's own
// Mod-a shortcut (editor.commands.selectAll) and clicks are dispatched as real
// DOM events — no test seams inside the production components.
//
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { TextEditor } from "./editor";
import { RichTextEditor } from "./rich-editor";
import { TextProps, paragraphDoc, textDefaultProps, type RichTextDoc, type TextProps as TextPropsValue } from "./schema";

let container: HTMLDivElement;
let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HELLO = paragraphDoc("Hello world");

function parsedProps(richText: TextPropsValue["richText"] = textDefaultProps().richText): TextProps {
  return TextProps.parse({ richText });
}

async function mount(
  component: React.ReactNode,
): Promise<void> {
  await act(async () => {
    root!.render(component);
    // Flush effects: the lazy editor chunk resolves in a microtask.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function prosemirror(): HTMLElement {
  const el = container.querySelector<HTMLElement>(".ProseMirror");
  if (el === null) throw new Error("ProseMirror element not mounted");
  return el;
}

function selectAll(): void {
  // Tiptap binds Mod-a → editor.commands.selectAll (core Editor shortcuts).
  act(() => {
    prosemirror().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        code: "KeyA",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function clickButton(testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (button === null) throw new Error(`button ${testId} not found`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function setInputValue(testId: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (input === null) throw new Error(`input ${testId} not found`);
  // React tracks controlled inputs by intercepting the value setter — set
  // through the prototype setter, then dispatch, like a real keystroke.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Last onChange payload as a doc JSON (throwing when absent). */
function lastEmitted(spy: Mock): RichTextDoc {
  const calls = spy.mock.calls as Array<[TextProps]>;
  expect(calls.length, "onChange called").toBeGreaterThan(0);
  return calls.at(-1)![0].richText as RichTextDoc;
}

function textNodesOf(doc: RichTextDoc): Array<{ text: string; marks: Array<{ type: string; attrs?: Record<string, unknown> }> }> {
  const out: Array<{ text: string; marks: Array<{ type: string; attrs?: Record<string, unknown> }> }> = [];
  const walk = (node: unknown): void => {
    const rec = node as { type?: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: unknown[] };
    if (rec.type === "text" && typeof rec.text === "string") {
      out.push({ text: rec.text, marks: rec.marks ?? [] });
      return;
    }
    for (const child of Array.isArray(rec.content) ? rec.content : []) walk(child);
  };
  walk(doc);
  return out;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
  root = null;
});

describe("TextEditor (lazy §13 shell)", () => {
  it("renders the read-only fallback first, then loads the Tiptap editor", async () => {
    const onChange = vi.fn();
    await mount(
      <TextEditor blockId="blk_text001" props={parsedProps()} onChange={onChange} />,
    );
    // NOTE: the very FIRST render is tested separately below (see sync test);
    // after the dynamic import settles the real editor is in the DOM.
    expect(container.querySelector('[data-testid="ff-text-editor"]')).not.toBeNull();
    expect(container.querySelector(".ProseMirror")?.textContent).toContain("Write something…");
    expect(onChange).not.toHaveBeenCalled(); // loading never mutates props
  });

  it("shows the loading fallback synchronously (static-markup/SSR contract)", async () => {
    // Render without flushing effects: what renderToStaticMarkup/SSR see.
    act(() => {
      root!.render(
        <TextEditor blockId="blk_text001" props={parsedProps()} onChange={vi.fn()} />,
      );
    });
    expect(container.querySelector('[data-testid="ff-text-editor-loading"]')).not.toBeNull();
    expect(container.textContent).toContain("Write something…");
    // Unflushed mount — clean up via afterEach.
  });
});

describe("RichTextEditor — §9.4 minimal toolbar", () => {
  it("bold applies a bold mark and emits schema-valid Tiptap JSON", async () => {
    const onChange = vi.fn();
    await mount(<RichTextEditor blockId="b" props={parsedProps(HELLO)} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-bold");

    const [node] = textNodesOf(lastEmitted(onChange));
    expect(node!.text).toBe("Hello world");
    expect(node!.marks.map((m) => m.type)).toContain("bold");
    expect(TextProps.safeParse({ richText: lastEmitted(onChange) }).success).toBe(true);
    expect(container.querySelector('[data-testid="ff-rt-bold"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("italic applies an italic mark", async () => {
    const onChange = vi.fn();
    await mount(<RichTextEditor blockId="b" props={parsedProps(HELLO)} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-italic");

    expect(textNodesOf(lastEmitted(onChange))[0]!.marks.map((m) => m.type)).toContain("italic");
  });

  it("strike applies a strike mark", async () => {
    const onChange = vi.fn();
    await mount(<RichTextEditor blockId="b" props={parsedProps(HELLO)} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-strike");

    expect(textNodesOf(lastEmitted(onChange))[0]!.marks.map((m) => m.type)).toContain("strike");
  });

  it("bullet list wraps the paragraph in bulletList/listItem", async () => {
    const onChange = vi.fn();
    await mount(<RichTextEditor blockId="b" props={parsedProps(HELLO)} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-bullet-list");

    const doc = lastEmitted(onChange);
    const list = doc.content?.[0] as { type?: string } | undefined;
    expect(list?.type).toBe("bulletList");
    expect(JSON.stringify(doc)).toContain('"listItem"');
  });

  it("ordered list wraps the paragraph in orderedList/listItem", async () => {
    const onChange = vi.fn();
    await mount(<RichTextEditor blockId="b" props={parsedProps(HELLO)} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-ordered-list");

    expect((lastEmitted(onChange).content?.[0] as { type?: string }).type).toBe("orderedList");
  });

  it("link: apply sets a link mark with the typed href", async () => {
    const onChange = vi.fn();
    await mount(<RichTextEditor blockId="b" props={parsedProps(HELLO)} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-link");
    setInputValue("ff-rt-link-input", "https://forge.example/page");
    clickButton("ff-rt-link-apply");

    const [node] = textNodesOf(lastEmitted(onChange));
    const link = node!.marks.find((m) => m.type === "link");
    expect(link?.attrs).toMatchObject({ href: "https://forge.example/page" });
    // Row closed after apply; button reflects the active link state.
    expect(container.querySelector('[data-testid="ff-rt-link-input"]')).toBeNull();
    expect(container.querySelector('[data-testid="ff-rt-link"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("link: unsafe hrefs are rejected with an inline error and never emitted", async () => {
    const onChange = vi.fn();
    await mount(<RichTextEditor blockId="b" props={parsedProps(HELLO)} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-link");
    setInputValue("ff-rt-link-input", "javascript:alert(1)");
    clickButton("ff-rt-link-apply");

    expect(container.querySelector('[data-testid="ff-rt-link-error"]')?.textContent).toContain("not allowed");
    expect(onChange).not.toHaveBeenCalled(); // doc untouched
  });

  it("link: remove clears an existing link mark", async () => {
    const onChange = vi.fn();
    const linked = TextProps.parse({
      richText: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello world", marks: [{ type: "link", attrs: { href: "https://x.example" } }] }],
          },
        ],
      },
    }).richText as RichTextDoc;
    await mount(<RichTextEditor blockId="b" props={parsedProps(linked)} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-link");
    // The row seeds itself with the selection's current href.
    expect(
      (container.querySelector<HTMLInputElement>('[data-testid="ff-rt-link-input"]') as HTMLInputElement).value,
    ).toBe("https://x.example");
    clickButton("ff-rt-link-remove");

    expect(textNodesOf(lastEmitted(onChange))[0]!.marks.map((m) => m.type)).not.toContain("link");
  });

  it("clear formatting strips marks and block structure", async () => {
    const onChange = vi.fn();
    const boldList = TextProps.parse({
      richText: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Hello world", marks: [{ type: "bold" }] }] },
                ],
              },
            ],
          },
        ],
      },
    }).richText as RichTextDoc;
    await mount(<RichTextEditor blockId="b" props={parsedProps(boldList)} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-clear");

    const doc = lastEmitted(onChange);
    expect((doc.content?.[0] as { type?: string }).type).toBe("paragraph");
    expect(textNodesOf(doc)[0]!.marks).toEqual([]);
  });

  it("external richText changes (Reset to defaults) are written into the editor", async () => {
    const onChange = vi.fn();
    await mount(<RichTextEditor blockId="b" props={parsedProps(HELLO)} onChange={onChange} />);
    expect(prosemirror().textContent).toContain("Hello world");

    const next = parsedProps(paragraphDoc("Reset to defaults"));
    await act(async () => {
      root!.render(<RichTextEditor blockId="b" props={next} onChange={onChange} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(prosemirror().textContent).toContain("Reset to defaults");
  });

  it("echoing its own emission does not reset the editor (no caret fight)", async () => {
    const onChange = vi.fn();
    const { richText } = TextProps.parse({ richText: HELLO });
    await mount(<RichTextEditor blockId="b" props={{ richText } as TextProps} onChange={onChange} />);
    selectAll();
    clickButton("ff-rt-bold");

    // Re-render with EXACTLY what the editor emitted (parent state echo).
    const emitted = lastEmitted(onChange);
    const calls = onChange.mock.calls.length;
    await act(async () => {
      root!.render(
        <RichTextEditor blockId="b" props={TextProps.parse({ richText: emitted })} onChange={onChange} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onChange.mock.calls.length).toBe(calls); // no extra update emitted
    expect(prosemirror().querySelector("strong")?.textContent).toBe("Hello world");
  });
});
