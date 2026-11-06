// DocumentOp vocabulary (spec §8) as zod, plus structural validation of a
// proposed op list against a concrete DocumentBody, plus a human-readable
// diff renderer used by the edit-with-AI review UI.
//
// INTEGRATION-DEBT: awaiting T04/T06 — when the canonical Op schema lands in
// @formforge/schema (or core/documents), replace the schemas below with a
// re-export of it. The AI edit flow must always speak the same op language
// as the authoring autosave PATCH endpoint.
import type { Block, DocumentBody } from "./types";
import { Block as BlockSchema, DocumentBody as DocumentBodySchema, Rule as RuleSchema, Theme as ThemeSchema } from "./types";
import { z } from "zod";

export const BlockInsertOp = z.object({
  type: z.literal("block.insert"),
  parentId: z.string().optional(),
  index: z.number().int().min(0),
  block: BlockSchema,
});

export const BlockUpdateOp = z.object({
  type: z.literal("block.update"),
  id: z.string(),
  props: z.record(z.string(), z.unknown()),
});

export const BlockMoveOp = z.object({
  type: z.literal("block.move"),
  id: z.string(),
  parentId: z.string().optional(),
  index: z.number().int().min(0),
});

export const BlockRemoveOp = z.object({
  type: z.literal("block.remove"),
  id: z.string(),
});

export const SettingsUpdateOp = z.object({
  type: z.literal("settings.update"),
  settings: DocumentBodySchema.shape.settings.partial(),
});

export const ThemeUpdateOp = z.object({
  type: z.literal("theme.update"),
  theme: ThemeSchema.partial(),
});

export const EndingUpsertOp = z.object({
  type: z.literal("ending.upsert"),
  ending: z.object({
    id: z.string(),
    title: z.string(),
    body: z.string().optional(),
    redirectUrl: z.string().url().optional(),
  }),
});

export const EndingRemoveOp = z.object({
  type: z.literal("ending.remove"),
  id: z.string(),
});

export const RuleUpsertOp = z.object({
  type: z.literal("rule.upsert"),
  rule: RuleSchema,
});

export const RuleRemoveOp = z.object({
  type: z.literal("rule.remove"),
  id: z.string(),
});

export const MetaUpdateOp = z.object({
  type: z.literal("meta.update"),
  meta: z.object({ title: z.string().optional(), slug: z.string().optional() }),
});

export const DocumentOp = z.discriminatedUnion("type", [
  BlockInsertOp,
  BlockUpdateOp,
  BlockMoveOp,
  BlockRemoveOp,
  SettingsUpdateOp,
  ThemeUpdateOp,
  EndingUpsertOp,
  EndingRemoveOp,
  RuleUpsertOp,
  RuleRemoveOp,
  MetaUpdateOp,
]);

export type DocumentOp = z.infer<typeof DocumentOp>;

/** All block ids reachable through `children`, in document order. */
export function collectBlockIds(blocks: Block[], into: Set<string> = new Set()): Set<string> {
  for (const block of blocks) {
    into.add(block.id);
    if (block.children) collectBlockIds(block.children, into);
  }
  return into;
}

export type OpValidationFailure = { ok: false; issues: string[] };

/**
 * Checks a parsed op list against the concrete document it proposes to edit:
 * referenced blocks/endings must exist, inserted ids must not collide, rule
 * scopes and goto targets must resolve. Pure — never mutates the document.
 */
export function validateOpsAgainstDocument(
  ops: DocumentOp[],
  document: DocumentBody,
): { ok: true } | OpValidationFailure {
  const issues: string[] = [];
  const blockIds = collectBlockIds(document.blocks);
  const endingIds = new Set(document.endings.map((e: { id: string }) => e.id));
  const topLevelCount = document.blocks.length;

  ops.forEach((op, i) => {
    const at = `ops[${i}]`;
    switch (op.type) {
      case "block.insert": {
        if (op.parentId !== undefined && !blockIds.has(op.parentId)) {
          issues.push(`${at}: parentId "${op.parentId}" does not exist`);
        }
        if (blockIds.has(op.block.id)) {
          issues.push(`${at}: inserted block id "${op.block.id}" already exists`);
        }
        if (op.index > topLevelCount && op.parentId === undefined) {
          issues.push(`${at}: index ${op.index} is beyond the end of the document (${topLevelCount})`);
        }
        break;
      }
      case "block.update":
      case "block.move":
      case "block.remove": {
        if (!blockIds.has(op.id)) {
          issues.push(`${at}: block "${op.id}" does not exist`);
        }
        break;
      }
      case "ending.upsert":
        break;
      case "ending.remove":
        if (!endingIds.has(op.id)) {
          issues.push(`${at}: ending "${op.id}" does not exist`);
        }
        break;
      case "rule.upsert": {
        const { scope } = op.rule;
        if (scope !== "start" && !blockIds.has(scope)) {
          issues.push(`${at}: rule scope "${scope}" is not "start" or an existing block id`);
        }
        for (const action of op.rule.then) {
          if (action.type !== "goto") continue;
          if (action.target.startsWith("end:")) {
            const endingId = action.target.slice("end:".length);
            if (!endingIds.has(endingId)) {
              issues.push(`${at}: goto target "${action.target}" points at a missing ending`);
            }
          } else if (!blockIds.has(action.target)) {
            issues.push(`${at}: goto target "${action.target}" is not an existing block id`);
          }
        }
        break;
      }
      case "rule.remove":
      case "settings.update":
      case "theme.update":
      case "meta.update":
        break;
    }
  });

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

function blockLabel(block: Block): string {
  const props = block.props as Record<string, unknown>;
  const label = [props.label, props.title, props.q].find(
    (v) => typeof v === "string" && v.length > 0,
  );
  return typeof label === "string" ? ` "${label}"` : "";
}

function findBlock(blocks: Block[], id: string): Block | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    const inChildren = block.children ? findBlock(block.children, id) : null;
    if (inChildren) return inChildren;
  }
  return null;
}

/** One human-readable line per op — the reviewable diff shown before apply. */
export function describeOps(ops: DocumentOp[], document: DocumentBody): string[] {
  return ops.map((op) => {
    switch (op.type) {
      case "block.insert": {
        const under = op.parentId ? ` under "${op.parentId}"` : "";
        return `Insert ${op.block.kind}${blockLabel(op.block)} at position ${op.index}${under}`;
      }
      case "block.update": {
        const block = findBlock(document.blocks, op.id);
        const keys = Object.keys(op.props).join(", ");
        return `Update ${block ? block.kind : "block"} "${op.id}" props${keys ? ` (${keys})` : ""}`;
      }
      case "block.move": {
        const block = findBlock(document.blocks, op.id);
        return `Move ${block ? block.kind : "block"} "${op.id}" to position ${op.index}`;
      }
      case "block.remove": {
        const block = findBlock(document.blocks, op.id);
        return `Remove ${block ? block.kind : "block"} "${op.id}"${block ? blockLabel(block) : ""}`;
      }
      case "settings.update":
        return `Update document settings (${Object.keys(op.settings).join(", ")})`;
      case "theme.update":
        return `Update theme (${Object.keys(op.theme).join(", ")})`;
      case "ending.upsert":
        return `Upsert ending "${op.ending.title}" (${op.ending.id})`;
      case "ending.remove":
        return `Remove ending "${op.id}"`;
      case "rule.upsert":
        return `Upsert rule "${op.rule.id}" scoped to ${op.rule.scope}`;
      case "rule.remove":
        return `Remove rule "${op.id}"`;
      case "meta.update":
        return `Update metadata (${Object.keys(op.meta).join(", ")})`;
    }
  });
}
