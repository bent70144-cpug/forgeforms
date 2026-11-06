// B6 redesign: structural preview rendered as hairline rows — kind chip in
// muted mono, block titles at text-sm/medium, nested children in a wash +
// hairline container, raw JSON behind a <details> on an ink surface. The
// schema-shaped data mapping (blockTitle, children recursion) is unchanged.
import type { DocumentBody } from "@formforge/core/ai";
import { BADGE_MUTED } from "@/lib/ui";

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
    <li className="py-2.5 first:pt-0 last:pb-0" data-kind={block.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${BADGE_MUTED} font-mono`}>{block.kind}</span>
        {title ? (
          <span className="min-w-0 text-sm font-medium text-[var(--ff-fg)]">{title}</span>
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
 * Lightweight structural preview of a DocumentBody. The real canvas preview
 * arrives with the block registry/renderers (T07+); this stays schema-shaped
 * so the AI review UI never depends on rendering internals.
 */
export function BodyPreview({ body }: { body: DocumentBody }) {
  return (
    <div className="space-y-3" aria-label="AI draft preview">
      <p className="text-xs tabular-nums text-[var(--ff-muted)]">
        {body.type} · {body.blocks.length} block{body.blocks.length === 1 ? "" : "s"} ·{" "}
        {body.endings.length} ending{body.endings.length === 1 ? "" : "s"}
        {body.logic.rules.length > 0 ? ` · ${body.logic.rules.length} rules` : ""}
      </p>
      {body.blocks.length > 0 ? (
        <ul className="divide-y divide-[var(--ff-border)]">
          {body.blocks.map((block) => (
            <BlockRow key={block.id} block={block} />
          ))}
        </ul>
      ) : null}
      {body.endings.length > 0 ? (
        <ul className="divide-y divide-[var(--ff-border)]">
          {body.endings.map((ending) => (
            <li key={ending.id} className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0">
              <span className={`${BADGE_MUTED} font-mono`}>ending</span>
              <span className="min-w-0 text-sm font-medium text-[var(--ff-fg)]">{ending.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-xs text-[var(--ff-muted)] underline underline-offset-2 transition-colors hover:text-[var(--ff-fg)]">
          Raw JSON
        </summary>
        <pre
          className="mt-2 max-h-64 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed"
          style={{ background: "#211d18", color: "#fdfcfa" }}
        >
          {JSON.stringify(body, null, 2)}
        </pre>
      </details>
    </div>
  );
}
