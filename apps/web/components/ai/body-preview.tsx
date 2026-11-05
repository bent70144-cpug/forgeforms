import type { DocumentBody } from "@formforge/core/ai";

type Block = DocumentBody["blocks"][number];

function blockTitle(block: Block): string {
  const props = block.props as Record<string, unknown>;
  const label = [props.label, props.title, props.q].find(
    (value) => typeof value === "string" && value.length > 0,
  );
  return typeof label === "string" ? label : "";
}

function BlockRow({ block, depth }: { block: Block; depth: number }) {
  const title = blockTitle(block);
  return (
    <li
      className="rounded border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700"
      style={{ marginLeft: `${depth * 12}px` }}
      data-kind={block.kind}
    >
      <span className="font-mono text-xs opacity-70">{block.kind}</span>
      {title ? <span className="ml-2">{title}</span> : null}
      {block.children && block.children.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {block.children.map((child) => (
            <BlockRow key={child.id} block={child} depth={depth + 1} />
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
      <p className="text-sm opacity-70">
        {body.type} · {body.blocks.length} block{body.blocks.length === 1 ? "" : "s"} ·{" "}
        {body.endings.length} ending{body.endings.length === 1 ? "" : "s"}
        {body.logic.rules.length > 0 ? ` · ${body.logic.rules.length} rules` : ""}
      </p>
      <ul className="space-y-2">
        {body.blocks.map((block) => (
          <BlockRow key={block.id} block={block} depth={0} />
        ))}
      </ul>
      {body.endings.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {body.endings.map((ending) => (
            <li key={ending.id}>
              <span className="font-mono text-xs opacity-70">ending</span> {ending.title}
            </li>
          ))}
        </ul>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer opacity-70">Raw JSON</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-neutral-100 p-2 dark:bg-neutral-800">
          {JSON.stringify(body, null, 2)}
        </pre>
      </details>
    </div>
  );
}
