// Meridian redesign: the preview renders as a white document sheet — 1px
// hairline border and a soft --ff-shadow-sm resting on the paper canvas, a
// card-2 chrome header ("Draft preview" terracotta badge + mono counts),
// hairline block rows (hidden blocks dimmed, nested children in a wash +
// hairline container), and the raw JSON on a quiet --ff-bg-2 well behind a
// <details>. The schema-shaped data mapping (blockTitle, children recursion)
// is unchanged.
import type { DocumentBody } from "@formforge/core/ai";
import { BADGE_ACCENT, BADGE_MUTED } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";

type Block = DocumentBody["blocks"][number];

function blockTitle(block: Block): string {
  const props = block.props as Record<string, unknown>;
  const label = [props.label, props.title, props.q].find(
    (value) => typeof value === "string" && value.length > 0,
  );
  return typeof label === "string" ? label : "";
}

function BlockRow({ block }: { block: Block }) {
  const title = blockTitle(block);
  return (
    <li
      className="py-2.5 first:pt-0 last:pb-0"
      data-kind={block.kind}
      style={block.hidden ? { opacity: 0.55 } : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${BADGE_MUTED} font-mono`}>{block.kind}</span>
        {title ? (
          <span className="min-w-0 text-sm font-medium text-[var(--ff-fg)]">{title}</span>
        ) : null}
        {block.hidden ? (
          <span className={`${BADGE_MUTED} ml-auto font-mono`}>hidden</span>
        ) : null}
      </div>
      {block.children && block.children.length > 0 ? (
        <ul
          className="mt-2 divide-y divide-[var(--ff-border)] rounded-xl border border-[var(--ff-border)] px-3 py-1"
          style={{ background: "color-mix(in srgb, var(--ff-fg) 2%, var(--ff-bg))" }}
        >
          {block.children.map((child) => (
            <BlockRow key={child.id} block={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Lightweight structural preview of a DocumentBody, rendered inside a bordered
 * document frame. The real canvas preview arrives with the block
 * registry/renderers (T07+); this stays schema-shaped so the AI review UI
 * never depends on rendering internals.
 */
export function BodyPreview({ body }: { body: DocumentBody }) {
  const blockCount = body.blocks.length;
  const endingCount = body.endings.length;
  return (
    <div
      aria-label="AI draft preview"
      className="overflow-hidden rounded-[14px]"
      style={{
        background: "var(--ff-card)",
        border: "1px solid var(--ff-border)",
        boxShadow: "var(--ff-shadow-sm)",
      }}
    >
      {/* Frame chrome: identity badge + schema counts. */}
      <div
        className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5"
        style={{
          borderColor: "var(--ff-border)",
          background: "var(--ff-card-2)",
        }}
      >
        <span className={BADGE_ACCENT}>
          <Icon name="sparkles" size={12} />
          Draft preview
        </span>
        <span className="ml-auto font-mono text-xs tabular-nums text-[var(--ff-muted)]">
          {body.type} · {blockCount} block{blockCount === 1 ? "" : "s"} · {endingCount} ending
          {endingCount === 1 ? "" : "s"}
          {body.logic.rules.length > 0 ? ` · ${body.logic.rules.length} rules` : ""}
        </span>
      </div>

      {/* Paper inset: blocks + endings as hairline rows. */}
      {blockCount > 0 ? (
        <ul className="divide-y divide-[var(--ff-border)] px-3.5">
          {body.blocks.map((block) => (
            <BlockRow key={block.id} block={block} />
          ))}
        </ul>
      ) : (
        <p className="px-3.5 py-4 text-sm text-[var(--ff-muted)]">
          No blocks in this draft yet.
        </p>
      )}
      {endingCount > 0 ? (
        <ul
          className={`divide-y divide-[var(--ff-border)] px-3.5 ${blockCount > 0 ? "border-t" : ""}`}
          style={{ borderColor: "var(--ff-border)" }}
        >
          {body.endings.map((ending) => (
            <li
              key={ending.id}
              className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0"
            >
              <span className={`${BADGE_MUTED} font-mono`}>ending</span>
              <span className="min-w-0 text-sm font-medium text-[var(--ff-fg)]">{ending.title}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Raw JSON on a recessed --ff-bg-2 well. */}
      <div className="border-t px-3.5 py-2.5" style={{ borderColor: "var(--ff-border)" }}>
        <details className="text-xs">
          <summary className="cursor-pointer text-xs text-[var(--ff-muted)] underline underline-offset-2 transition-colors hover:text-[var(--ff-fg)]">
            Raw JSON
          </summary>
          <pre
            className="mt-2 max-h-64 overflow-auto rounded-[10px] border p-3 font-mono text-xs leading-relaxed"
            style={{
              borderColor: "var(--ff-border)",
              background: "var(--ff-bg-2)",
              color: "var(--ff-fg)",
            }}
          >
            {JSON.stringify(body, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
