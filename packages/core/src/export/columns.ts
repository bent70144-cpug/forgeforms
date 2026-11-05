// T18 (issue #18) — column mapping from document questions (spec §7).
//
// One CSV column per question block, keyed by the block id ("column ids =
// stable headers"): editing a question's label never shifts or renames
// columns, and answer values always land in the right column even if the
// form is reordered between submissions.
//
// SPEC-NOTE: the block registry (packages/blocks, T03) is not importable from
// core, so "question block" is defined by the MVP kind list in spec §7.2 plus
// container kinds that recurse. When the registry lands, this walker can be
// re-pointed at `BlockDef.family === "question"` without changing the output.

import type { CsvColumn } from "./csv";

/** Ids of the fixed system columns the export prepends to the question columns. */
export const SYSTEM_COLUMN_IDS = {
  submissionId: "submission_id",
  submittedAt: "submitted_at",
  status: "status",
} as const;

/** Question block kinds from spec §7.2 (blocks that store an answer). */
export const QUESTION_BLOCK_KINDS: ReadonlySet<string> = new Set([
  "short-text",
  "long-text",
  "email",
  "number",
  "single-select",
  "multi-select",
  "dropdown",
  "rating",
  "nps",
  "file-upload",
]);

/** Layout kinds whose children are walked recursively (spec §7.2). */
const CONTAINER_BLOCK_KINDS: ReadonlySet<string> = new Set([
  "section",
  "columns",
  "multi-question-page",
]);

/** Minimal structural view of a block from `DocumentBody` (spec §7) — keeps core decoupled from packages/schema. */
export type BlockLike = {
  id: string;
  kind: string;
  props?: Record<string, unknown>;
  children?: readonly BlockLike[];
  hidden?: boolean;
};

export type SelectOption = { readonly id: string; readonly label: string };

/**
 * A CSV column for a question block: stable header = block id, plus the
 * metadata needed to render answers (human label, select options).
 */
export type QuestionColumn = CsvColumn & {
  readonly kind?: string;
  readonly label?: string;
  readonly options?: readonly SelectOption[];
};

/** Fixed leading columns: id, submitted-at timestamp and completion status. */
export const SYSTEM_COLUMNS: readonly QuestionColumn[] = [
  { id: SYSTEM_COLUMN_IDS.submissionId, header: SYSTEM_COLUMN_IDS.submissionId },
  { id: SYSTEM_COLUMN_IDS.submittedAt, header: SYSTEM_COLUMN_IDS.submittedAt },
  { id: SYSTEM_COLUMN_IDS.status, header: SYSTEM_COLUMN_IDS.status },
];

/**
 * Derives CSV columns from a `DocumentBody.blocks` tree, depth-first, in
 * document order: system columns first (unless `systemColumns: false`), then
 * one column per visible question block, recursing into layout containers.
 * Hidden blocks never receive answers (spec §7.1) and are skipped.
 */
export function questionColumnsFromDocument(
  blocks: readonly BlockLike[],
  opts?: { systemColumns?: boolean },
): QuestionColumn[] {
  const questionColumns: QuestionColumn[] = [];
  const walk = (list: readonly BlockLike[]): void => {
    for (const block of list) {
      if (block.hidden) continue;
      if (CONTAINER_BLOCK_KINDS.has(block.kind)) {
        walk(block.children ?? []);
        continue;
      }
      if (QUESTION_BLOCK_KINDS.has(block.kind)) questionColumns.push(toQuestionColumn(block));
    }
  };
  walk(blocks);
  const systemColumns = opts?.systemColumns ?? true;
  return systemColumns ? [...SYSTEM_COLUMNS, ...questionColumns] : questionColumns;
}

function toQuestionColumn(block: BlockLike): QuestionColumn {
  const props = block.props ?? {};
  const label = typeof props.label === "string" ? props.label : undefined;
  const options = Array.isArray(props.options)
    ? props.options.flatMap((option) => {
        const record = option as Record<string, unknown>;
        return typeof record?.id === "string" && typeof record?.label === "string"
          ? [{ id: record.id, label: record.label }]
          : [];
      })
    : undefined;
  return { id: block.id, header: block.id, kind: block.kind, label, options };
}

function labelFor(options: readonly SelectOption[], optionId: string): string {
  return options.find((option) => option.id === optionId)?.label ?? optionId;
}

/**
 * Renders one answer cell, resolving stored answer shapes into human text:
 *   single-select/dropdown  { optionId }        → option label
 *   single-select "other"   { other }           → the free text
 *   multi-select            { optionIds: [] }   → labels joined with "; "
 *   file-upload             { assetIds: [] }    → asset ids joined with "; "
 *   anything else                               → formatCsvValue
 */
export function formatAnswerCell(value: unknown, column: CsvColumn): string {
  const options = readOptions(column);
  if (options && value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.optionId === "string") return labelFor(options, record.optionId);
    if (typeof record.other === "string") return record.other;
    if (Array.isArray(record.optionIds)) {
      return record.optionIds
        .filter((id): id is string => typeof id === "string")
        .map((id) => labelFor(options, id))
        .join("; ");
    }
    if (Array.isArray(record.assetIds)) {
      return record.assetIds
        .filter((id): id is string => typeof id === "string")
        .join("; ");
    }
  }
  return formatCsvValue(value);
}

function readOptions(column: CsvColumn): readonly SelectOption[] | undefined {
  // Safe: only QuestionColumn instances carry `options`; plain CsvColumns fall through.
  return (column as QuestionColumn).options;
}
