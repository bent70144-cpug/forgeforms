'use client';

// Per-card error containment (builder spec §5.4): a block whose renderer
// throws must never take the builder down. The boundary swaps just that card
// for an explainer with the stored props (JSON) and a Delete action.
import { Component, type ReactNode } from "react";
import type { Block } from "@formforge/schema";

/** §semantic warning card (Meridian): --ff-warning-soft fill with a 1px
 *  warning-tinted hairline — tokenized, flips with the light/dark scheme. */
const WARN_TINT = {
  borderColor: "color-mix(in srgb, var(--ff-warning) 38%, transparent)",
  background: "var(--ff-warning-soft)",
} as const;

function propsJson(props: Record<string, unknown>): string {
  try {
    return JSON.stringify(props, null, 2);
  } catch {
    return String(props); // circular props — still show something
  }
}

export function BlockErrorFallback({
  block,
  onDelete,
}: {
  block: Block;
  onDelete: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="block-error"
      style={WARN_TINT}
      className="rounded-xl border p-4"
    >
      <p className="text-sm font-medium text-[color:var(--ff-warning)]">This block has an error</p>
      <p className="mt-1 text-sm text-[color:var(--ff-muted)]">
        The preview failed to render. Your content is preserved.
      </p>
      <details className="mt-2">
        <summary
          className="cursor-pointer text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-[color:var(--ff-warning)] underline"
          style={{ fontFamily: "var(--ff-font-mono)" }}
        >
          View stored props
        </summary>
        <pre
          className="mt-2 max-h-40 overflow-auto rounded-lg border border-[color:var(--ff-border)] bg-[color:var(--ff-bg)] p-2 text-[0.6875rem] text-[color:var(--ff-muted)]"
          style={{ fontFamily: "var(--ff-font-mono)" }}
        >
          {propsJson(block.props)}
        </pre>
      </details>
      <button
        type="button"
        aria-label="Delete block"
        onClick={onDelete}
        className="ff-btn ff-btn-secondary ff-btn-sm mt-3"
      >
        Delete
      </button>
    </div>
  );
}

type BlockErrorBoundaryProps = {
  block: Block;
  onDelete: () => void;
  children: ReactNode;
};

type BlockErrorBoundaryState = { error: Error | null };

export class BlockErrorBoundary extends Component<
  BlockErrorBoundaryProps,
  BlockErrorBoundaryState
> {
  state: BlockErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BlockErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(): void {
    // Containment only — telemetry (privacy-safe, §15) hooks in wave 3.
  }

  render() {
    if (this.state.error) {
      return (
        <BlockErrorFallback block={this.props.block} onDelete={this.props.onDelete} />
      );
    }
    return this.props.children;
  }
}
