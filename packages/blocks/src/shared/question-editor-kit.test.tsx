// @vitest-environment jsdom
// W10 (follow-up §9.3) — shared option-list keyboard interactions in
// `OptionsFields`: Enter-adds-below, Backspace-on-empty-deletes (min 1 guard),
// multi-line paste split (incl. the 200-option cap note per §14) and the live
// inline duplicate-label warning (publish-time DUP_OPTION stays the gate).
//
// The interaction contract is DOM behavior (focus, key events, clipboard), so
// this file opts into jsdom via the docblock above and drives React 19 with
// `act` + native event dispatch. The pure helpers are also covered directly;
// the surrounding editors keep their node-env SSR coverage in
// question-render.test.tsx / catalog.test.tsx.
//
// §9.1/§10 — W12 additions: question-editor-kit image row + asset-picker host
// seam tests (static render + direct seam contract tests).

import { act, createElement as h, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPTION_LIST_MAX,
  GenericQuestionFields,
  OptionsFields,
  duplicateOptionLabels,
  pickImageAsset,
  setAssetPickerOpener,
  splitPasteLines,
  splitPastedOptions,
} from "./question-editor-kit";
import type { Option } from "./option-list";

// React 19 requires the act environment flag when tests drive updates via act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const opt = (id: string, label: string): Option => ({ id, label });

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: Option[] = [];

/** Mount OptionsFields in a tiny state harness; `latest` mirrors editor state. */
function mount(initial: Option[]): void {
  latest = initial;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const Harness = (): ReactElement => {
    const [options, setOptions] = useState(initial);
    return (
      <OptionsFields
        options={options}
        onOptionsChange={(next) => {
          latest = next;
          setOptions(next);
        }}
      />
    );
  };
  act(() => {
    root!.render(<Harness />);
  });
}

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  latest = [];
});

const editor = (): HTMLElement => container!.querySelector("[data-options-editor]")!;
const inputs = (): HTMLInputElement[] =>
  Array.from(editor().querySelectorAll<HTMLInputElement>("input[type='text']"));
const notes = (): string[] =>
  Array.from(editor().querySelectorAll<HTMLElement>("p[role='note']")).map((p) => p.textContent ?? "");
const removeButtons = (): HTMLButtonElement[] =>
  Array.from(editor().querySelectorAll<HTMLButtonElement>("button")).filter(
    (button) => button.textContent === "✕",
  );
const inputAt = (index: number): HTMLInputElement => inputs()[index]!;
const removeButtonAt = (index: number): HTMLButtonElement => removeButtons()[index]!;
const addOptionButton = (): HTMLButtonElement =>
  Array.from(editor().querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent === "Add option",
  )!;

async function press(input: HTMLInputElement, key: string): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/**
 * Simulate author typing: bypass React's value tracker with the prototype's
 * native setter (a plain `input.value = …` assignment is captured by the
 * tracker and swallowed), then fire the change event React listens to.
 */
function setNativeValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(input.constructor.prototype, "value");
  descriptor?.set?.call(input, value);
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    setNativeValue(input, text);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Simulate a clipboard paste (jsdom has no ClipboardEvent/DataTransfer). */
async function paste(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (kind: string) => (kind === "text/plain" ? text : "") },
    });
    input.dispatchEvent(event);
  });
}

/** A unique-labelled list of n options (labels "Option 2".."Option n" after row 0). */
function listOf(n: number, firstLabel = "X"): Option[] {
  return Array.from({ length: n }, (_, i) => opt(`opt_${i}`, i === 0 ? firstLabel : `Option ${i + 1}`));
}

describe("splitPasteLines (§9.3 paste-split helper)", () => {
  it("splits LF, CRLF and CR lines and trims each", () => {
    expect(splitPasteLines("Red\nGreen")).toEqual(["Red", "Green"]);
    expect(splitPasteLines("Red\r\nGreen\r\nBlue")).toEqual(["Red", "Green", "Blue"]);
    expect(splitPasteLines("Red\rGreen")).toEqual(["Red", "Green"]);
  });

  it("drops blank lines and whitespace-only lines", () => {
    expect(splitPasteLines("\nRed\n\n  \nGreen\n")).toEqual(["Red", "Green"]);
    expect(splitPasteLines("   ")).toEqual([]);
    expect(splitPasteLines("")).toEqual([]);
  });
});

describe("splitPastedOptions (§9.3 paste-split helper)", () => {
  const makeId = (existing: readonly Option[]): string =>
    `fresh_${existing.length}`; // deterministic stub for tests

  it("lands the first line in the pasted-into row (id stable) and adds the rest below", () => {
    const before = [opt("a", "A"), opt("b", "B")];
    const result = splitPastedOptions(before, 0, ["R1", "R2", "R3"], makeId);
    expect(result.options).toEqual([
      opt("a", "R1"), // pasted-into row keeps its id
      opt("fresh_2", "R2"),
      opt("fresh_3", "R3"),
      opt("b", "B"),
    ]);
    expect(result.added).toBe(2);
    expect(result.dropped).toBe(0);
    expect(result.focusIndex).toBe(1); // first NEW row
  });

  it("inserts below the target row, not only at the end", () => {
    const before = [opt("a", "A"), opt("b", "B"), opt("c", "C")];
    const result = splitPastedOptions(before, 1, ["R1", "R2"], makeId);
    expect(result.options.map((o) => o.id)).toEqual(["a", "b", "fresh_3", "c"]);
    expect(result.focusIndex).toBe(2);
  });

  it("caps at the limit and reports the dropped lines", () => {
    const before = listOf(199);
    const result = splitPastedOptions(before, 0, ["R1", "R2", "R3", "R4", "R5"], makeId);
    expect(result.options).toHaveLength(200);
    expect(result.added).toBe(1);
    expect(result.dropped).toBe(3);
    expect(result.options[0]).toEqual(opt("opt_0", "R1"));
    expect(result.options[199]).toEqual(opt("opt_198", "Option 199"));
    expect(result.options[1]?.label).toBe("R2");
  });

  it("never shrinks a full list: one line lands, the rest are dropped", () => {
    const before = listOf(OPTION_LIST_MAX);
    const result = splitPastedOptions(before, 0, ["R1", "R2"], makeId);
    expect(result.options).toHaveLength(OPTION_LIST_MAX);
    expect(result.options[0]?.label).toBe("R1");
    expect(result.added).toBe(0);
    expect(result.dropped).toBe(1);
    expect(result.focusIndex).toBeNull(); // nothing added → keep current focus
  });

  it("is a no-op for an empty paste", () => {
    const before = [opt("a", "A")];
    const result = splitPastedOptions(before, 0, [], makeId);
    expect(result.options).toEqual(before);
    expect(result.focusIndex).toBeNull();
  });
});

describe("duplicateOptionLabels (mirrors publish-time DUP_OPTION)", () => {
  it("finds exact duplicates (trimmed), keeping first-occurrence order", () => {
    expect(duplicateOptionLabels([opt("a", "Blue"), opt("b", "Blue"), opt("c", "Blue"), opt("d", "Red")])).toEqual([
      "Blue",
    ]);
    expect(duplicateOptionLabels([opt("a", " A "), opt("b", "A")])).toEqual(["A"]);
    expect(duplicateOptionLabels([opt("a", "Blue"), opt("b", "blue")])).toEqual([]); // case-sensitive
  });

  it("ignores empty labels (rows being typed are not duplicates)", () => {
    expect(duplicateOptionLabels([opt("a", ""), opt("b", "")])).toEqual([]);
  });
});

describe("OptionsFields keyboard interactions (§9.3)", () => {
  it("Enter adds an empty option directly below and focuses it", async () => {
    mount([opt("a", "Red"), opt("b", "Blue")]);
    await press(inputAt(0), "Enter");
    expect(latest.map((o) => [o.id, o.label])).toEqual([
      ["a", "Red"],
      [expect.any(String), ""],
      ["b", "Blue"],
    ]);
    expect(inputs()).toHaveLength(3);
    expect(document.activeElement).toBe(inputs()[1]); // the new row is focused
    expect(notes()).toEqual([]);
  });

  it("Enter in the last row appends and keeps earlier ids stable", async () => {
    mount([opt("a", "Red"), opt("b", "Blue")]);
    await press(inputAt(1), "Enter");
    expect(latest).toHaveLength(3);
    expect(latest[0]?.id).toBe("a");
    expect(latest[1]?.id).toBe("b");
    expect(latest[2]?.label).toBe("");
    expect(document.activeElement).toBe(inputs()[2]);
  });

  it("other keys do not add rows", async () => {
    mount([opt("a", "Red")]);
    await press(inputAt(0), "Space");
    await press(inputAt(0), "Escape");
    expect(latest).toHaveLength(1);
  });

  it("Backspace on an empty option deletes it and focuses the previous input", async () => {
    mount([opt("a", "Red"), opt("b", "")]);
    await press(inputAt(1), "Backspace");
    expect(latest).toEqual([opt("a", "Red")]);
    expect(document.activeElement).toBe(inputs()[0]);
  });

  it("Backspace on the first of several rows focuses the surviving first row", async () => {
    mount([opt("a", ""), opt("b", "Blue")]);
    await press(inputAt(0), "Backspace");
    expect(latest).toEqual([opt("b", "Blue")]);
    expect(document.activeElement).toBe(inputs()[0]);
  });

  it("Backspace on a NON-empty option does not delete it", async () => {
    mount([opt("a", "Red"), opt("b", "Blue")]);
    await press(inputAt(1), "Backspace");
    expect(latest).toHaveLength(2);
    expect(latest[1]).toEqual(opt("b", "Blue"));
  });

  it("min-1 guard: Backspace on the only (empty) option is a no-op", async () => {
    mount([opt("a", "")]);
    const first = inputAt(0);
    first.focus();
    await press(first, "Backspace");
    expect(latest).toHaveLength(1);
    expect(latest[0]).toEqual(opt("a", ""));
    expect(document.activeElement).toBe(first); // focus unchanged
  });

  it("Backspace typing through a label then emptying it deletes the row", async () => {
    mount([opt("a", "Red"), opt("b", "Blue")]);
    await type(inputAt(1), ""); // empty the label (value tracker: "Blue" → "")
    await press(inputAt(1), "Backspace");
    expect(latest).toEqual([opt("a", "Red")]);
  });
});

describe("OptionsFields paste-split (§9.3 + §14 cap note)", () => {
  it("multi-line paste splits into separate options with fresh ids below", async () => {
    mount([opt("a", "Red"), opt("b", "Blue")]);
    await paste(inputAt(0), "Red\nGreen\nTeal");
    expect(latest.map((o) => [o.id, o.label])).toEqual([
      ["a", "Red"], // pasted-into row keeps its id
      [expect.any(String), "Green"],
      [expect.any(String), "Teal"],
      ["b", "Blue"],
    ]);
    expect(document.activeElement).toBe(inputs()[1]); // first new row
    expect(notes()).toEqual([]); // no truncation → no note
  });

  it("single-line paste is left to native input behavior (no state change)", async () => {
    mount([opt("a", "Red"), opt("b", "Blue")]);
    await paste(inputAt(0), "Just one line");
    expect(latest).toEqual([opt("a", "Red"), opt("b", "Blue")]);
  });

  it("CRLF and trailing blank lines are handled", async () => {
    mount([opt("a", "Red")]);
    await paste(inputAt(0), "One\r\nTwo\r\n");
    expect(latest.map((o) => o.label)).toEqual(["One", "Two"]);
  });

  it("paste is capped at the option limit with a non-blocking note", async () => {
    mount(listOf(199));
    await paste(inputAt(0), "R1\nR2\nR3\nR4\nR5");
    expect(latest).toHaveLength(200);
    expect(latest[0]?.label).toBe("R1");
    expect(latest[1]?.label).toBe("R2");
    expect(latest[199]?.label).toBe("Option 199");
    expect(notes()).toEqual([`Option limit reached (${OPTION_LIST_MAX}) — kept 2 of 5 pasted lines.`]);
    expect(document.activeElement).toBe(inputs()[1]); // first new row
  });

  it("pasting into a full list keeps one line and notes the truncation", async () => {
    mount(listOf(OPTION_LIST_MAX));
    const first = inputAt(0);
    first.focus();
    await paste(first, "R1\nR2\nR3");
    expect(latest).toHaveLength(OPTION_LIST_MAX);
    expect(latest[0]?.label).toBe("R1");
    expect(notes()).toEqual([`Option limit reached (${OPTION_LIST_MAX}) — kept 1 of 3 pasted lines.`]);
    expect(document.activeElement).toBe(first); // nothing added → focus unchanged
  });

  it("the cap note clears once rows drop below the limit again", async () => {
    mount(listOf(OPTION_LIST_MAX));
    await paste(inputAt(0), "R1\nR2\nR3");
    expect(notes()).toHaveLength(1);
    await act(async () => {
      removeButtonAt(5).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(latest).toHaveLength(OPTION_LIST_MAX - 1);
    expect(notes()).toEqual([]);
  });

  it("Add option is disabled at the cap; Enter there notes the limit and adds nothing", async () => {
    mount(listOf(OPTION_LIST_MAX));
    expect(addOptionButton().disabled).toBe(true);
    await press(inputAt(0), "Enter");
    expect(latest).toHaveLength(OPTION_LIST_MAX);
    expect(notes()).toEqual([`Option limit reached (${OPTION_LIST_MAX}).`]);
  });

  it("Add option is enabled below the cap and appends a default-labelled row", async () => {
    mount([opt("a", "Red")]);
    expect(addOptionButton().disabled).toBe(false);
    await act(async () => {
      addOptionButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(latest).toHaveLength(2);
    expect(latest[1]?.label).toBe("Option 2");
    expect(latest[0]?.id).toBe("a"); // existing ids untouched
  });
});

describe("OptionsFields inline duplicate warning (non-blocking)", () => {
  it("warns when two options share a label, mirroring the publish message", async () => {
    mount([opt("a", "Blue"), opt("b", "Blue"), opt("c", "Red")]);
    const warning = notes().find((text) => text.includes("DUP_OPTION"));
    expect(warning).toContain("Duplicate option label:");
    expect(warning).toContain("“Blue”");
  });

  it("uses plural copy for multiple duplicated labels", async () => {
    mount([opt("a", "Blue"), opt("b", "Blue"), opt("c", "Red"), opt("d", "Red")]);
    const warning = notes().find((text) => text.includes("DUP_OPTION"));
    expect(warning).toContain("Duplicate option labels:");
    expect(warning).toContain("“Blue”");
    expect(warning).toContain("“Red”");
  });

  it("the warning disappears when the label is edited", async () => {
    mount([opt("a", "Blue"), opt("b", "Blue")]);
    expect(notes().some((text) => text.includes("DUP_OPTION"))).toBe(true);
    await type(inputAt(1), "Green");
    expect(notes().some((text) => text.includes("DUP_OPTION"))).toBe(false);
    expect(latest.map((o) => o.label)).toEqual(["Blue", "Green"]);
    expect(latest[0]?.id).toBe("a"); // ids stay stable while labels are edited
  });

  it("empty rows never count as duplicates", async () => {
    mount([opt("a", ""), opt("b", "")]);
    expect(notes()).toEqual([]);
  });
});

describe("OptionsFields server-safe render (regression guard)", () => {
  it("still renders rows via renderToStaticMarkup without notes for unique labels", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(
      <OptionsFields options={[opt("a", "Red"), opt("b", "Blue")]} onOptionsChange={() => {}} />,
    );
    expect(html).toContain('aria-label="Option 1 label"');
    expect(html).toContain('aria-label="Option 2 label"');
    expect(html).toContain("Add option");
    expect(html).not.toContain("DUP_OPTION");
  });
});

function renderFields(props: { imageAssetId?: string } = {}, disabled = false): string {
  return renderToStaticMarkup(
    h(GenericQuestionFields, {
      props: { required: false, ...props },
      onPatch: () => {},
      disabled,
    }),
  );
}

afterEach(() => {
  setAssetPickerOpener(null);
});

describe("GenericQuestionFields image row (§9.1)", () => {
  it("renders the image row: manual id input + the §10 Choose image… button", () => {
    const html = renderFields();
    expect(html).toContain("Image asset");
    expect(html).toContain('data-image-row');
    expect(html).toContain('aria-label="Image asset id"');
    expect(html).toContain("Choose image…");
  });

  it("shows the current reference and a remove button only when one is set", () => {
    const html = renderFields({ imageAssetId: "ast_0001" });
    expect(html).toContain('value="ast_0001"');
    expect(html).toContain('aria-label="Remove image"');
    expect(renderFields()).not.toContain('aria-label="Remove image"');
  });

  it("disables the row controls with the editor", () => {
    const html = renderFields({ imageAssetId: "ast_0001" }, true);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Remove image"');
    expect(html).toContain('>Choose image…</button>');
  });
});

describe("asset-picker host seam (§10)", () => {
  it("pickImageAsset resolves through the registered opener with supportsAlt", async () => {
    const opener = vi.fn(async () => ({ assetId: "ast_0001" }));
    setAssetPickerOpener(opener);
    await expect(pickImageAsset(false)).resolves.toEqual({ assetId: "ast_0001" });
    expect(opener).toHaveBeenCalledWith({ supportsAlt: false });
  });

  it("passes supportsAlt through (gallery ImageAssetRef records store alt)", async () => {
    const opener = vi.fn(async () => ({ assetId: "ast_0002", alt: "Team offsite" }));
    setAssetPickerOpener(opener);
    await expect(pickImageAsset(true)).resolves.toEqual({ assetId: "ast_0002", alt: "Team offsite" });
    expect(opener).toHaveBeenCalledWith({ supportsAlt: true });
  });

  it("resolves null with no host registered (manual-edit fallback, never throws)", async () => {
    setAssetPickerOpener(null);
    await expect(pickImageAsset(false)).resolves.toBeNull();
  });

  it("resolves null when the host is registered and the user cancels", async () => {
    setAssetPickerOpener(async () => null);
    await expect(pickImageAsset(false)).resolves.toBeNull();
  });
});
