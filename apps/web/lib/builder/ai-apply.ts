// AI-proposal → builder-apply bridge (spec §11: "applying dispatches ops
// through the normal path, so it is one undoable group (group id on history
// entries)").
//
// The AI edit endpoint (POST /api/v1/ai/edit) answers with the CORE op
// vocabulary — `{ type: "block.insert", … }`, `settings`/`theme`/`meta`
// payload keys (packages/core/src/ai/ops.ts). The builder store, history and
// PATCH transport speak the WIRE vocabulary — `{ op: "block.insert", … }`,
// `patch` payload keys (lib/builder/ops.ts). This module is the pure bridge:
//
//   toBuilderOp / toBuilderOps   core AI op → builder Op (null for junk ops)
//   toGroupedApply(ops, batchId) {ops, label, group} for ONE undoable dispatch
//   summarizeOpsDiff(ops)        counts + human diff lines for the review UI
//
// Pure module: no React, no DOM, no fetch — unit-testable (vitest node env).

import type { Block, Ending, Rule } from "../bridge";
import { blockDisplayLabel, getBlockMeta } from "./blockMeta";
import type { MetaPatch, Op, SettingsPatch, ThemePatch } from "./ops";

// ---------------------------------------------------------------------------
// Core AI op vocabulary (structural mirror of packages/core/src/ai/ops.ts)
// ---------------------------------------------------------------------------

type CoreAiOp = {
  type: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Minimal structural Block check — the AI's block JSON is untrusted. */
function isBlockLike(value: unknown): value is Block {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["kind"] === "string" &&
    isRecord(value["props"])
  );
}

/**
 * Convert one core AI op into the builder Op vocabulary.
 * Returns `null` for anything malformed/unknown — callers drop it instead of
 * poisoning an apply batch (the server would 422 the whole PATCH anyway).
 */
export function toBuilderOp(raw: unknown): Op | null {
  if (!isRecord(raw)) return null;
  const core = raw as CoreAiOp;
  switch (core["type"]) {
    case "block.insert": {
      const block = core["block"];
      const index = core["index"];
      if (!isBlockLike(block) || typeof index !== "number") return null;
      return {
        op: "block.insert",
        parentId: typeof core["parentId"] === "string" ? core["parentId"] : null,
        index,
        block,
      };
    }
    case "block.update": {
      if (typeof core["id"] !== "string" || !isRecord(core["props"])) return null;
      return { op: "block.update", id: core["id"], props: core["props"] };
    }
    case "block.move": {
      if (typeof core["id"] !== "string" || typeof core["index"] !== "number") return null;
      return {
        op: "block.move",
        id: core["id"],
        parentId: typeof core["parentId"] === "string" ? core["parentId"] : null,
        index: core["index"],
      };
    }
    case "block.remove": {
      if (typeof core["id"] !== "string") return null;
      return { op: "block.remove", id: core["id"] };
    }
    case "settings.update": {
      const settings = core["settings"];
      if (!isRecord(settings)) return null;
      return { op: "settings.update", patch: settings as unknown as SettingsPatch };
    }
    case "theme.update": {
      const theme = core["theme"];
      if (!isRecord(theme)) return null;
      return { op: "theme.update", patch: theme as unknown as ThemePatch };
    }
    case "ending.upsert": {
      const ending = core["ending"];
      if (!isRecord(ending) || typeof ending["id"] !== "string") return null;
      return { op: "ending.upsert", ending: ending as unknown as Ending };
    }
    case "ending.remove": {
      if (typeof core["id"] !== "string") return null;
      return { op: "ending.remove", id: core["id"] };
    }
    case "rule.upsert": {
      const rule = core["rule"];
      if (!isRecord(rule) || typeof rule["id"] !== "string") return null;
      return { op: "rule.upsert", rule: rule as unknown as Rule };
    }
    case "rule.remove": {
      if (typeof core["id"] !== "string") return null;
      return { op: "rule.remove", id: core["id"] };
    }
    case "meta.update": {
      const meta = core["meta"];
      if (!isRecord(meta)) return null;
      return { op: "meta.update", patch: meta as unknown as MetaPatch };
    }
    default:
      return null;
  }
}

/** Convert + drop malformed ops (order preserved). */
export function toBuilderOps(rawOps: readonly unknown[]): Op[] {
  const out: Op[] = [];
  for (const raw of rawOps) {
    const op = toBuilderOp(raw);
    if (op) out.push(op);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grouped apply (§11: one undoable group per AI apply)
// ---------------------------------------------------------------------------

/** Exactly the optional fields of the store's `{ type: "apply" }` action. */
export type GroupedApply = {
  ops: Op[];
  /** History/undo-toast label for the whole batch. */
  label: string;
  /** Group id — history entries sharing it undo/redo as ONE step. */
  group: string;
};

/**
 * Bundle `ops` into one grouped apply payload. Wave-3 builder wiring:
 *
 *   const grouped = toGroupedApply(builderOps, batchId);
 *   dispatch({ type: "apply", ...grouped });
 */
export function toGroupedApply(ops: readonly Op[], batchId: string): GroupedApply {
  const n = ops.length;
  return {
    ops: [...ops],
    label: `Apply AI edits (${n} change${n === 1 ? "" : "s"})`,
    group: `ai:${batchId}`,
  };
}

// ---------------------------------------------------------------------------
// Diff summary (review UI: counts + human list lines)
// ---------------------------------------------------------------------------

export type OpDiffSummary = {
  /** block.insert */
  added: number;
  /** block.update */
  changed: number;
  /** block.remove */
  removed: number;
  /** block.move */
  moved: number;
  /** settings/theme/ending/rule/meta ops */
  other: number;
  total: number;
  /** One human line per op, in op order — e.g. `+ Short text “Email”`. */
  lines: string[];
};

const SIGNS = { insert: "+", update: "~", remove: "−", move: "→", other: "•" } as const;

function kindLabelOf(block: Block): string {
  return getBlockMeta(block.kind)?.label ?? block.kind;
}

/** `“Email”` suffix when the block carries a display label distinct from its kind label. */
function blockNameSuffix(block: Block): string {
  const display = blockDisplayLabel(block);
  if (display === block.kind || display === kindLabelOf(block)) return "";
  return ` “${display}”`;
}

function settingKeys(patch: Record<string, unknown>): string {
  const keys = Object.keys(patch);
  return keys.length > 0 ? ` (${keys.join(", ")})` : "";
}

/** One human line per op — privacy-safe for the UI (block kinds + labels only). */
export function summarizeOpsDiff(ops: readonly Op[]): OpDiffSummary {
  let added = 0;
  let changed = 0;
  let removed = 0;
  let moved = 0;
  let other = 0;
  const lines: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "block.insert": {
        added += 1;
        lines.push(`${SIGNS.insert} ${kindLabelOf(op.block)}${blockNameSuffix(op.block)}`);
        break;
      }
      case "block.update": {
        changed += 1;
        const keys = Object.keys(op.props);
        lines.push(
          `${SIGNS.update} Block ${op.id}${keys.length > 0 ? ` (${keys.join(", ")})` : ""}`,
        );
        break;
      }
      case "block.remove": {
        removed += 1;
        lines.push(`${SIGNS.remove} Block ${op.id}`);
        break;
      }
      case "block.move": {
        moved += 1;
        lines.push(`${SIGNS.move} Block ${op.id} → position ${op.index}`);
        break;
      }
      case "settings.update": {
        other += 1;
        lines.push(`${SIGNS.other} Settings${settingKeys(op.patch as Record<string, unknown>)}`);
        break;
      }
      case "theme.update": {
        other += 1;
        lines.push(`${SIGNS.other} Theme${settingKeys(op.patch as Record<string, unknown>)}`);
        break;
      }
      case "ending.upsert": {
        other += 1;
        lines.push(`${SIGNS.other} Ending “${op.ending.title}”`);
        break;
      }
      case "ending.remove": {
        other += 1;
        lines.push(`${SIGNS.other} Ending removed (${op.id})`);
        break;
      }
      case "rule.upsert": {
        other += 1;
        lines.push(`${SIGNS.other} Logic rule (${op.rule.id})`);
        break;
      }
      case "rule.remove": {
        other += 1;
        lines.push(`${SIGNS.other} Logic rule removed (${op.id})`);
        break;
      }
      case "meta.update": {
        other += 1;
        lines.push(`${SIGNS.other} Document${settingKeys(op.patch as Record<string, unknown>)}`);
        break;
      }
    }
  }

  return { added, changed, removed, moved, other, total: ops.length, lines };
}
