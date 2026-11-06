'use client';

// Per-card error containment (builder spec §5.4): a block whose renderer
// throws must never take the builder down. The boundary swaps just that card
// for an explainer with the stored props (JSON) and a Delete action.
import { Component, type ReactNode } from "react";
import type { Block } from "@formforge/schema";

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
      className="rounded-md border border-amber-300 bg-amber-50 p-4"
    >
      <p className="font-medium text-amber-900">This block has an error</p>
      <p className="mt-1 text-sm text-amber-800">
        The preview failed to render. Your content is preserved.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-medium text-amber-900 underline">
          View stored props
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-white p-2 text-xs text-slate-700">
          {propsJson(block.props)}
        </pre>
      </details>
      <button
        type="button"
        aria-label="Delete block"
        onClick={onDelete}
        className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
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
