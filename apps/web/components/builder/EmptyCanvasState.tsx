'use client';

// Empty-document state (builder spec §5.3): quiet Meridian composition —
// line icon on a recessed circle, Sora title, the three suggested blocks,
// a ghost action that opens the shared block picker (same "ff:open-picker"
// contract the canvas insertion rows use) and the template link. Each
// suggestion dispatches a root block.insert at index 0 and selects the new
// block (done by the caller).
//
// NOTE on tokens: this component renders INSIDE the themed canvas subtree
// (the document theme remaps --ff-bg/--ff-fg/--ff-primary/--ff-muted/
// --ff-border/--ff-primary-fg), so surface/text colors intentionally use
// those document tokens — a hard --ff-bg-2 circle would not flip with the
// document theme, so the recessed circle mixes --ff-border into --ff-bg
// instead (same quiet-well effect, theme-live).
import { Icon } from "@/components/ui/icons";
import { emitOpenPicker } from "@/lib/builder/canvas-ops";
import { QUICK_ADD_KINDS } from "./InsertionRow";

export function EmptyCanvasState({ onAdd }: { onAdd: (kind: string) => void }) {
  return (
    <div
      data-testid="empty-canvas"
      className="mt-4 rounded-[var(--ff-radius)] border border-dashed p-8 text-center sm:p-10"
      style={{
        background: "color-mix(in srgb, var(--ff-fg) 3%, var(--ff-bg))",
        borderColor: "var(--ff-border)",
      }}
    >
      <span
        aria-hidden="true"
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
        style={{
          background: "color-mix(in srgb, var(--ff-border) 45%, var(--ff-bg))",
          color: "var(--ff-muted)",
        }}
      >
        <Icon name="plus" size={22} />
      </span>

      <h2
        className="mt-4 text-lg font-semibold tracking-[-0.02em] text-[color:var(--ff-fg)]"
        style={{ fontFamily: "var(--ff-font-heading)" }}
      >
        Add your first question
      </h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-[color:var(--ff-muted)]">
        Pick a suggestion below, or hover between blocks and press “+”.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {QUICK_ADD_KINDS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            aria-label={`Add ${entry.label}`}
            onClick={() => onAdd(entry.kind)}
            className="min-h-[44px] rounded-[calc(var(--ff-radius)*0.5)] border px-4 py-2.5 text-sm font-medium transition-colors hover:[border-color:color-mix(in_srgb,var(--ff-primary)_50%,var(--ff-border))] hover:[background:color-mix(in_srgb,var(--ff-primary)_7%,transparent)]"
            style={{
              background: "color-mix(in srgb, var(--ff-fg) 3%, transparent)",
              borderColor: "var(--ff-border)",
              color: "var(--ff-fg)",
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => emitOpenPicker({ index: 0, parentId: null })}
        className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-1.5 text-sm font-semibold hover:underline"
        style={{ color: "var(--ff-primary)" }}
      >
        Browse all blocks
      </button>

      <a
        href="/templates"
        target="_blank"
        rel="noreferrer"
        className="mt-2 block text-sm font-medium underline underline-offset-2 text-[color:var(--ff-muted)] transition-colors hover:text-[color:var(--ff-fg)]"
      >
        Start from a template
      </a>
    </div>
  );
}
