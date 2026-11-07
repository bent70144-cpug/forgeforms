'use client';

// Unknown block kind (builder spec §5.4): grey dashed placeholder for kinds
// this version doesn't know about ("future-widget" from an older/newer
// client). Props are preserved; the toolbar is limited to Duplicate/Delete.
import { memo } from "react";
import type { Block } from "@formforge/schema";
import type { CanvasActions } from "@/lib/builder/canvas-ops";
import { BlockToolbar } from "./BlockToolbar";

export type UnknownBlockProps = {
  block: Block;
  index: number;
  /** Container block id, or null for the root list (§6.2 drag targeting). */
  parentId?: string | null;
  siblingCount: number;
  selected: boolean;
  referencedIds: ReadonlySet<string>;
  actions: CanvasActions;
};

function UnknownBlockImpl({
  block,
  index,
  parentId = null,
  siblingCount,
  selected,
  referencedIds,
  actions,
}: UnknownBlockProps) {
  return (
    <article
      role="group"
      aria-label={`Unsupported block (${block.kind})`}
      data-testid="unknown-block"
      data-block-id={block.id}
      data-block-kind={block.kind}
      data-block-parent={parentId ?? ""}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        actions.select(block.id);
      }}
      onFocus={() => {
        if (!selected) actions.select(block.id);
      }}
      className="relative cursor-default rounded-[var(--ff-radius)] border border-dashed border-slate-300 bg-slate-50 p-4 outline-1 outline-offset-2 outline-transparent hover:[outline-color:var(--ff-border)] focus-visible:[outline:2px_solid_var(--ff-primary)]"
      style={{ contentVisibility: "auto", containIntrinsicSize: "80px" }}
    >
      {selected ? (
        <BlockToolbar
          block={block}
          index={index}
          parentId={parentId}
          siblingCount={siblingCount}
          referencedByRules={referencedIds.has(block.id)}
          actions={actions}
          limited
        />
      ) : null}
      <p className="text-sm font-medium text-slate-600">
        This block type isn&apos;t supported in this version
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Unknown type <code className="rounded bg-slate-200 px-1">{block.kind}</code> — its content
        is preserved and still publishes.
      </p>
    </article>
  );
}

/** Memoized like every card (spec §13). */
export const UnknownBlock = memo(UnknownBlockImpl);
