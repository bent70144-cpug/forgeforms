'use client';

// Block card (builder spec §5.1/§5.2): the canvas unit for one block —
// selection chrome, inline-editable primary text, a disabled live preview via
// the registry Render, the floating toolbar when selected, and (for container
// kinds) nested child cards with their own insertion points.
//
// Memoized per spec §13: all collaborators arrive as stable props (actions
// object + referencedIds are memoized in Canvas), so a card only re-renders
// when its own block reference / position / selection changes.
import { Fragment, memo, useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Block } from "@formforge/schema";
import { getBlockDef, type AnyBlockDef } from "@formforge/blocks";
import type { CanvasActions } from "@/lib/builder/canvas-ops";
import {
  blockDisplayLabel,
  blockIcon,
  getBlockMeta,
  isContainerKind,
} from "@/lib/builder/blockMeta";
import { BlockErrorBoundary } from "./BlockErrorBoundary";
import { BlockToolbar } from "./BlockToolbar";
import { InlineEditable } from "./InlineEditable";
import { InsertionRow } from "./InsertionRow";
import { UnknownBlock } from "./UnknownBlock";

export type BlockCardProps = {
  block: Block;
  /** Nesting level (0 = root list) — exposed for tests/future styles. */
  depth: number;
  /** Position in the parent list, for move boundaries + insert indices. */
  index: number;
  /** Container block id, or null for the root list (§6.2 drag targeting). */
  parentId?: string | null;
  siblingCount: number;
  /** Whether THIS card is the selected one (chrome + toolbar). */
  selected: boolean;
  /** Current selection id — lets nested child cards resolve their own
   *  selection without a context subscription (keeps memo effective). */
  selectedId: string | null;
  /** Block ids referenced by logic rules (§6.4 delete-warning hints). */
  referencedIds: ReadonlySet<string>;
  actions: CanvasActions;
  /**
   * Id of the block whose primary text should currently be editing — the
   * wave-3 "ff:edit-selected" contract (useShortcuts Enter). Each card
   * compares itself; threaded down so nested children can match too.
   */
  editingId?: string | null;
  /** Called when this card's inline edit commits or cancels so Canvas can
   *  clear its editing signal (§6.5 Esc/Enter). */
  onEditSettled?: () => void;
};

// Disabled live preview: parse stored props through the kind's propsSchema and
// render the public renderer with all interactivity off. Invalid props show an
// inline notice instead of nothing so broken blocks stay visible/editable in
// the builder (the public BlockView fails soft to null — too silent here).
function BlockPreview({ def, block }: { def: AnyBlockDef; block: Block }) {
  const parsed = def.propsSchema.safeParse(block.props);
  if (!parsed.success) {
    return (
      <p className="text-xs text-[color:var(--ff-warning)]" data-testid="block-props-invalid">
        Preview unavailable — fix this block&apos;s settings in the right pane.
      </p>
    );
  }
  const Render = def.Render;
  return <Render props={parsed.data} disabled />;
}

function BlockCardImpl({
  block,
  depth,
  index,
  parentId = null,
  siblingCount,
  selected,
  selectedId,
  referencedIds,
  actions,
  editingId = null,
  onEditSettled,
}: BlockCardProps) {
  // Wave-3 "ff:edit-selected" contract: the canvas mirrors the requested edit
  // id here; the editor opens on mount (initialEditingBlockId test seam) and
  // on every false→true transition — idempotent with the card's own Enter.
  const requestEdit = editingId === block.id;
  const [editingPrimary, setEditingPrimary] = useState(requestEdit);
  useEffect(() => {
    if (requestEdit) setEditingPrimary(true);
  }, [requestEdit]);

  const def = getBlockDef(block.kind);
  if (!def) {
    return (
      <UnknownBlock
        block={block}
        index={index}
        parentId={parentId}
        siblingCount={siblingCount}
        selected={selected}
        referencedIds={referencedIds}
        actions={actions}
      />
    );
  }

  const meta = getBlockMeta(block.kind);
  const primaryProp = meta?.primaryProp;
  const rawPrimary = primaryProp ? block.props[primaryProp] : undefined;
  const primaryValue = typeof rawPrimary === "string" ? rawPrimary : null;
  const primaryMultiline =
    primaryProp !== undefined &&
    meta?.fields.some((field) => field.key === primaryProp && field.type === "textarea");
  const children = block.children ?? [];
  const showChildrenZone = isContainerKind(block.kind) || children.length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return; // card itself focused only
    if (event.key === "Enter" && primaryValue !== null) {
      event.preventDefault();
      setEditingPrimary(true); // §6.5: Enter edits the primary text inline
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      actions.select(null); // §6.5: Esc deselects
    }
  };

  // Meridian card: a white sheet on the document sheet — 1px hairline, soft
  // paper shadow at rest; the selected card earns a 1.5px ultramarine border
  // plus a 4% ultramarine tint. No glow, no lift — print-like elevation.
  const cardClassName = selected
    ? "relative w-full cursor-pointer rounded-[var(--ff-radius)] border bg-[color:color-mix(in_srgb,var(--ff-primary)_4%,var(--ff-bg))] p-4 text-left text-[color:var(--ff-fg)] focus-visible:[outline:2px_solid_var(--ff-primary)] focus-visible:[outline-offset:2px]"
    : "relative w-full cursor-pointer rounded-[var(--ff-radius)] border bg-[color:var(--ff-bg)] p-4 text-left text-[color:var(--ff-fg)] transition-[border-color,box-shadow] duration-200 ease-[var(--ff-ease-out)] hover:[border-color:var(--ff-border-strong)] focus-visible:[outline:2px_solid_var(--ff-primary)] focus-visible:[outline-offset:2px]";

  const cardStyle: CSSProperties = selected
    ? {
        borderWidth: "1.5px",
        borderColor: "var(--ff-primary)",
        boxShadow: "var(--ff-shadow-sm)",
        contentVisibility: "auto",
        containIntrinsicSize: "80px",
      }
    : {
        borderColor: "var(--ff-border)",
        boxShadow: "var(--ff-shadow-sm)",
        contentVisibility: "auto",
        containIntrinsicSize: "80px",
      };

  return (
    <article
      role="group"
      aria-label={blockDisplayLabel(block)}
      data-testid={`block-card-${block.id}`}
      data-block-id={block.id}
      data-block-kind={block.kind}
      data-block-parent={parentId ?? ""}
      data-depth={depth}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        actions.select(block.id);
      }}
      onFocus={() => {
        if (!selected) actions.select(block.id);
      }}
      onKeyDown={handleKeyDown}
      className={cardClassName}
      style={cardStyle}
    >
      {selected ? (
        <BlockToolbar
          block={block}
          index={index}
          parentId={parentId}
          siblingCount={siblingCount}
          referencedByRules={referencedIds.has(block.id)}
          actions={actions}
        />
      ) : null}

      <BlockErrorBoundary block={block} onDelete={() => actions.remove(block.id)}>
        <header className="flex items-center gap-2 pr-2">
          {/* Type-specific accent icon: quiet ultramarine tint tile. */}
          <span
            aria-hidden="true"
            style={{
              background: "color-mix(in srgb, var(--ff-primary) 8%, transparent)",
              color: "var(--ff-primary)",
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-xs"
          >
            {blockIcon(block.kind)}
          </span>
          {/* type chip — mono microtext (Meridian telemetry voice) */}
          {primaryValue !== null && (
            <span
              aria-hidden="true"
              className="shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.625rem] leading-none text-[color:var(--ff-muted)]"
              style={{
                fontFamily: "var(--ff-font-mono)",
                border: "1px solid var(--ff-border)",
              }}
            >
              {meta?.label ?? block.kind}
            </span>
          )}
          <span className="min-w-0 flex-1 text-sm font-medium">
            {primaryValue !== null ? (
              <InlineEditable
                value={primaryValue}
                editing={editingPrimary}
                onBegin={() => setEditingPrimary(true)}
                onCommit={(next) => {
                  setEditingPrimary(false);
                  onEditSettled?.();
                  actions.updatePrimaryText(block.id, primaryProp as string, next);
                }}
                onCancel={() => {
                  setEditingPrimary(false);
                  onEditSettled?.();
                }}
                ariaLabel={`Edit ${meta?.label ?? block.kind} text`}
                multiline={primaryMultiline === true}
              />
            ) : (
              <span className="text-[color:var(--ff-muted)]">{meta?.label ?? block.kind}</span>
            )}
          </span>
        </header>

        {/* Disabled preview: pointer-events off so clicks always hit the card. */}
        <div aria-hidden="true" className="mt-3" style={{ pointerEvents: "none" }}>
          <BlockPreview def={def} block={block} />
        </div>

        {showChildrenZone ? (
          <div
            data-testid="block-children"
            className="mt-3 space-y-2 rounded-md border-l-2 border-dashed border-[color:var(--ff-border)] pl-3"
          >
            {children.map((child, childIndex) => (
              <Fragment key={child.id}>
                <BlockCard
                  block={child}
                  depth={depth + 1}
                  index={childIndex}
                  parentId={block.id}
                  siblingCount={children.length}
                  selected={child.id === selectedId}
                  selectedId={selectedId}
                  referencedIds={referencedIds}
                  actions={actions}
                  editingId={editingId}
                  onEditSettled={onEditSettled}
                />
                <InsertionRow index={childIndex + 1} parentId={block.id} actions={actions} />
              </Fragment>
            ))}
            {children.length === 0 ? (
              <p className="py-1 text-xs text-[color:var(--ff-muted)]">Empty container — add blocks below.</p>
            ) : null}
            <InsertionRow index={children.length} parentId={block.id} actions={actions} />
          </div>
        ) : null}
      </BlockErrorBoundary>
    </article>
  );
}

export const BlockCard = memo(BlockCardImpl);
