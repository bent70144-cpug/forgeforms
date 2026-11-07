// Ops-based document editing (spec §8 "Autosave (authoring)" + §11 PATCH contract).
//
// Ops are what the client sends to `PATCH /api/v1/documents/:id` as
// `{ baseRev, ops: Op[] }`; the server applies them in one transaction against
// `documents.draft`, validates the result with `DocumentBody` and increments
// `rev` (409 CONFLICT when `baseRev` is stale).
//
// This module is the pure client-side mirror: apply ops to an {meta, body}
// pair, derive inverse ops for undo/redo, duplicate subtrees, and apply
// best-effort (used by 409 recovery). No React, no DOM — fully unit-testable.

import type {
  Block,
  DocumentBody,
  DocumentSettings,
  DocumentType,
  Ending,
  Rule,
  Theme,
} from "@formforge/schema";
import { DEFAULT_THEME_TOKENS } from "../bridge";
import { newId } from "./id";

export type DocMeta = { title: string; slug?: string };
export type EditableDoc = { meta: DocMeta; body: DocumentBody };

export type ThemePatch = Partial<Pick<Theme, "fontHeading" | "fontBody" | "radius">> & {
  /** Merged per token key (not replaced wholesale). */
  tokens?: Record<string, string | null>;
};

export type SettingsPatch = Partial<
  Omit<DocumentSettings, "seo" | "closeAt" | "maxSubmissions" | "retentionDays" | "hiddenFields">
> & {
  // Per-key merge with `null` = delete (§21 exact inverses; mirrors the
  // nullable sub-fields of SettingsPatchSchema in @formforge/schema).
  seo?: Partial<{ [K in keyof DocumentSettings["seo"]]: DocumentSettings["seo"][K] | null }>;
  closeAt?: string | null;
  maxSubmissions?: number | null;
  retentionDays?: number | null;
  hiddenFields?: DocumentSettings["hiddenFields"] | null;
};

/** meta.update patch — `slug: null` deletes/unsets the slug (§21 inverse). */
export type MetaPatch = { title?: string; slug?: string | null };

// SPEC-NOTE: op shapes follow spec §8. `block.update` is a shallow *merge* into
// `props` (partial autosave patches); the spec does not pin merge granularity.
// Extension (INTEGRATION-DEBT for T07 server parity): a patch value of `null`
// DELETES the key — needed so undo can remove keys that an earlier patch added.
// Blocks never store `null` prop values in normal editing.
// B1/§21 (2025): ending/rule upserts carry `index?` (position for NEW entries,
// per the §21 inverse of ending.remove / rule.remove); meta/settings patches
// accept the null delete-token so inverses are exact.
export type Op =
  | { op: "block.insert"; parentId?: string | null; index: number; block: Block }
  | { op: "block.update"; id: string; props: Record<string, unknown> }
  | { op: "block.move"; id: string; parentId?: string | null; index: number }
  | { op: "block.remove"; id: string }
  | { op: "settings.update"; patch: SettingsPatch }
  | { op: "theme.update"; patch: ThemePatch }
  | { op: "ending.upsert"; index?: number; ending: Ending }
  | { op: "ending.remove"; id: string }
  | { op: "rule.upsert"; index?: number; rule: Rule }
  | { op: "rule.remove"; id: string }
  | { op: "meta.update"; patch: MetaPatch };

export type OpErrorCode = "NOT_FOUND" | "BAD_INDEX" | "INVALID";

export class OpError extends Error {
  constructor(
    public readonly code: OpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpError";
  }
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

export type FoundBlock = {
  block: Block;
  /** Ancestors, outermost → innermost (excludes the block itself). */
  trail: Block[];
  /** Parent's children list (root list when parent is null). */
  list: Block[];
  index: number;
};

export function findBlock(list: Block[], id: string, trail: Block[] = []): FoundBlock | null {
  for (let i = 0; i < list.length; i++) {
    const block = list[i];
    if (!block) continue;
    if (block.id === id) return { block, trail, list, index: i };
    if (block.children) {
      const found = findBlock(block.children, id, [...trail, block]);
      if (found) return found;
    }
  }
  return null;
}

function leafChildrenList(body: DocumentBody, trail: Block[]): Block[] {
  if (trail.length === 0) return body.blocks;
  const parent = trail[trail.length - 1];
  return parent?.children ?? [];
}

/**
 * Rebuild the ancestor path so that `newLeafList` becomes the children list of
 * `trail`'s innermost element (or the root list when trail is empty).
 * Callers pass the full ancestor chain *including* the parent whose children
 * they are replacing.
 */
function rebuildPathFrom(rootList: Block[], trail: Block[], newLeafList: Block[]): Block[] {
  if (trail.length === 0) return newLeafList;
  const head = trail[0];
  if (!head) return rootList;
  return rootList.map((b) =>
    b.id === head.id
      ? { ...b, children: rebuildPathFrom(b.children ?? [], trail.slice(1), newLeafList) }
      : b,
  );
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(Math.round(index), length));
}

// ---------------------------------------------------------------------------
// applyOps
// ---------------------------------------------------------------------------

/** Apply ops left-to-right; throws OpError on the first invalid op. */
export function applyOps(doc: EditableDoc, ops: readonly Op[]): EditableDoc {
  let next = doc;
  for (const op of ops) {
    next = applyOp(next, op);
  }
  return next;
}

function applyOp(doc: EditableDoc, op: Op): EditableDoc {
  switch (op.op) {
    case "block.insert": {
      if (op.parentId) {
        const parent = findBlock(doc.body.blocks, op.parentId);
        if (!parent) throw new OpError("NOT_FOUND", `block.insert: parent ${op.parentId} not found`);
        const copy = [...(parent.block.children ?? [])];
        copy.splice(clampIndex(op.index, copy.length), 0, op.block);
        const blocks = rebuildPathFrom(doc.body.blocks, [...parent.trail, parent.block], copy);
        return { ...doc, body: { ...doc.body, blocks } };
      }
      const blocks = [...doc.body.blocks];
      blocks.splice(clampIndex(op.index, blocks.length), 0, op.block);
      return { ...doc, body: { ...doc.body, blocks } };
    }

    case "block.update": {
      const found = findBlock(doc.body.blocks, op.id);
      if (!found) throw new OpError("NOT_FOUND", `block.update: ${op.id} not found`);
      const list = leafChildrenList(doc.body, found.trail);
      const copy = list.map((b) => {
        if (b.id !== op.id) return b;
        const merged = { ...b.props };
        for (const [k, v] of Object.entries(op.props)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        return { ...b, props: merged };
      });
      const blocks = rebuildPathFrom(doc.body.blocks, found.trail, copy);
      return { ...doc, body: { ...doc.body, blocks } };
    }

    case "block.move": {
      const found = findBlock(doc.body.blocks, op.id);
      if (!found) throw new OpError("NOT_FOUND", `block.move: ${op.id} not found`);
      const currentParentId = found.trail.length > 0
        ? (found.trail[found.trail.length - 1]?.id ?? null)
        : null;
      const targetParentId = op.parentId ?? null;

      // Step 1: remove from the current location.
      const oldList = leafChildrenList(doc.body, found.trail);
      const withoutBlock = oldList.filter((b) => b.id !== op.id);
      const body1Blocks = rebuildPathFrom(doc.body.blocks, found.trail, withoutBlock);

      // Step 2: insert at the destination. `index` is the final position in
      // the destination list *after* removal (same-list moves included).
      if (targetParentId === currentParentId) {
        const next = [...withoutBlock];
        next.splice(clampIndex(op.index, next.length), 0, found.block);
        const blocks = rebuildPathFrom(body1Blocks, found.trail, next);
        return { ...doc, body: { ...doc.body, blocks } };
      }
      if (targetParentId) {
        const dest = findBlock(body1Blocks, targetParentId);
        if (!dest) throw new OpError("NOT_FOUND", `block.move: parent ${targetParentId} not found`);
        const destList = [...(dest.block.children ?? [])];
        destList.splice(clampIndex(op.index, destList.length), 0, found.block);
        const blocks = rebuildPathFrom(body1Blocks, [...dest.trail, dest.block], destList);
        return { ...doc, body: { ...doc.body, blocks } };
      }
      const blocks = [...body1Blocks];
      blocks.splice(clampIndex(op.index, blocks.length), 0, found.block);
      return { ...doc, body: { ...doc.body, blocks } };
    }

    case "block.remove": {
      const found = findBlock(doc.body.blocks, op.id);
      if (!found) throw new OpError("NOT_FOUND", `block.remove: ${op.id} not found`);
      const list = leafChildrenList(doc.body, found.trail);
      const copy = list.filter((b) => b.id !== op.id);
      const blocks = rebuildPathFrom(doc.body.blocks, found.trail, copy);
      return { ...doc, body: { ...doc.body, blocks } };
    }

    case "settings.update": {
      // Merge-patch convention (parity with core/documents/apply.ts): top-level
      // keys merge with `null` = delete; `seo` merges per key the same way.
      // mergeWithDelete already copies the base — do NOT pre-spread settings,
      // or keys deleted by the patch would survive (§21 exactness).
      const seo = op.patch.seo
        ? mergeWithDelete(doc.body.settings.seo as Record<string, unknown>, op.patch.seo as Record<string, unknown>)
        : doc.body.settings.seo;
      const settings: DocumentSettings = {
        ...mergeWithDelete(doc.body.settings as Record<string, unknown>, stripSeo(op.patch)),
        seo,
      } as DocumentSettings;
      return { ...doc, body: { ...doc.body, settings } };
    }

    case "theme.update": {
      const theme: Theme = mergeWithDelete(
        doc.body.theme as Record<string, unknown>,
        stripTokens(op.patch),
      ) as Theme;
      if (op.patch.tokens) {
        const tokens = { ...doc.body.theme.tokens };
        for (const [k, v] of Object.entries(op.patch.tokens)) {
          if (v === null) delete tokens[k];
          else tokens[k] = v;
        }
        theme.tokens = tokens;
      }
      return { ...doc, body: { ...doc.body, theme } };
    }

    case "ending.upsert": {
      const exists = doc.body.endings.some((e) => e.id === op.ending.id);
      if (exists) {
        // Replace in place; `index` only positions NEW endings (§21).
        const endings = doc.body.endings.map((e) => (e.id === op.ending.id ? op.ending : e));
        return { ...doc, body: { ...doc.body, endings } };
      }
      const endings = [...doc.body.endings];
      endings.splice(clampIndex(op.index ?? endings.length, endings.length), 0, op.ending);
      return { ...doc, body: { ...doc.body, endings } };
    }

    case "ending.remove": {
      const endings = doc.body.endings.filter((e) => e.id !== op.id);
      return { ...doc, body: { ...doc.body, endings } };
    }

    case "rule.upsert": {
      const exists = doc.body.logic.rules.some((r) => r.id === op.rule.id);
      if (exists) {
        const rules = doc.body.logic.rules.map((r) => (r.id === op.rule.id ? op.rule : r));
        return { ...doc, body: { ...doc.body, logic: { rules } } };
      }
      const rules = [...doc.body.logic.rules];
      rules.splice(clampIndex(op.index ?? rules.length, rules.length), 0, op.rule);
      return { ...doc, body: { ...doc.body, logic: { rules } } };
    }

    case "rule.remove": {
      const rules = doc.body.logic.rules.filter((r) => r.id !== op.id);
      return { ...doc, body: { ...doc.body, logic: { rules } } };
    }

    case "meta.update": {
      // `null` deletes the key (e.g. unset a slug) — keeps undo byte-exact.
      return { ...doc, meta: mergeWithDelete(doc.meta as Record<string, unknown>, op.patch) as DocMeta };
    }

    default: {
      const exhaustive: never = op;
      throw new OpError("INVALID", `Unknown op: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function stripSeo(patch: SettingsPatch): Omit<SettingsPatch, "seo"> {
  const { seo: _seo, ...rest } = patch;
  return rest;
}

function stripTokens(patch: ThemePatch): Omit<ThemePatch, "tokens"> {
  const { tokens: _tokens, ...rest } = patch;
  return rest;
}

/** Shallow merge where `null` values delete the key (see SPEC-NOTE on Op). */
function mergeWithDelete(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inverse ops (undo/redo)
// ---------------------------------------------------------------------------

/**
 * Derive the ops that undo `ops` against `docBefore`.
 * Walks ops forward over a simulated doc so each inverse reflects the state
 * right before its op ran.
 */
export function invertOps(docBefore: EditableDoc, ops: readonly Op[]): Op[] {
  const inverse: Op[] = [];
  let sim = docBefore;
  for (const op of ops) {
    const inv = invertSingle(sim, op);
    if (inv) inverse.unshift(inv);
    sim = applyOps(sim, [op]);
  }
  return inverse;
}

function invertSingle(sim: EditableDoc, op: Op): Op | null {
  switch (op.op) {
    case "block.insert":
      return { op: "block.remove", id: op.block.id };
    case "block.remove": {
      const found = findBlock(sim.body.blocks, op.id);
      if (!found) return null;
      const parent = found.trail.length > 0 ? (found.trail[found.trail.length - 1] ?? null) : null;
      return { op: "block.insert", parentId: parent?.id ?? null, index: found.index, block: found.block };
    }
    case "block.move": {
      const found = findBlock(sim.body.blocks, op.id);
      if (!found) return null;
      const parent = found.trail.length > 0 ? (found.trail[found.trail.length - 1] ?? null) : null;
      return { op: "block.move", id: op.id, parentId: parent?.id ?? null, index: found.index };
    }
    case "block.update": {
      const found = findBlock(sim.body.blocks, op.id);
      if (!found) return null;
      const inv: Record<string, unknown> = {};
      for (const k of Object.keys(op.props)) {
        if (k in found.block.props) inv[k] = found.block.props[k];
        else inv[k] = null; // key was added by the op → undo deletes it
      }
      return { op: "block.update", id: op.id, props: inv };
    }
    case "theme.update": {
      const old = sim.body.theme;
      const { tokens, ...rest } = op.patch;
      const inv: Record<string, unknown> = {};
      for (const k of Object.keys(rest)) {
        inv[k] = (old as unknown as Record<string, unknown>)[k];
      }
      if (tokens) {
        const invTokens: Record<string, unknown> = {};
        for (const k of Object.keys(tokens)) {
          invTokens[k] = k in old.tokens ? old.tokens[k] : null;
        }
        inv.tokens = invTokens;
      }
      return { op: "theme.update", patch: inv as ThemePatch };
    }
    case "settings.update": {
      const old = sim.body.settings;
      const { seo, ...rest } = op.patch;
      const inv: Record<string, unknown> = {};
      for (const k of Object.keys(rest)) {
        // Key absent before the op → inverse deletes it again (§21 exact undo).
        inv[k] = k in old ? (old as unknown as Record<string, unknown>)[k] : null;
      }
      if (seo) {
        const invSeo: Record<string, unknown> = {};
        const oldSeo = old.seo as Record<string, unknown>;
        for (const k of Object.keys(seo)) {
          invSeo[k] = k in oldSeo ? oldSeo[k] : null;
        }
        inv.seo = invSeo;
      }
      return { op: "settings.update", patch: inv as SettingsPatch };
    }
    case "ending.upsert": {
      const old = sim.body.endings.find((e) => e.id === op.ending.id);
      return old ? { op: "ending.upsert", ending: old } : { op: "ending.remove", id: op.ending.id };
    }
    case "ending.remove": {
      const idx = sim.body.endings.findIndex((e) => e.id === op.id);
      if (idx < 0) return null;
      const old = sim.body.endings[idx];
      // §21: re-insert at the ORIGINAL index (ending.upsert positions new entries).
      return old ? { op: "ending.upsert", index: idx, ending: old } : null;
    }
    case "rule.upsert": {
      const old = sim.body.logic.rules.find((r) => r.id === op.rule.id);
      return old ? { op: "rule.upsert", rule: old } : { op: "rule.remove", id: op.rule.id };
    }
    case "rule.remove": {
      const idx = sim.body.logic.rules.findIndex((r) => r.id === op.id);
      if (idx < 0) return null;
      const old = sim.body.logic.rules[idx];
      // §21: re-insert at the ORIGINAL index (rule.upsert positions new rules).
      return old ? { op: "rule.upsert", index: idx, rule: old } : null;
    }
    case "meta.update": {
      const old = sim.meta as Record<string, unknown>;
      const inv: Record<string, unknown> = {};
      for (const k of Object.keys(op.patch)) {
        // Key absent before (e.g. slug) → inverse deletes it again (§21).
        inv[k] = k in old ? old[k] : null;
      }
      return { op: "meta.update", patch: inv as MetaPatch };
    }
    default: {
      const exhaustive: never = op;
      throw new OpError("INVALID", `Cannot invert op: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Best-effort application (409 recovery replays)
// ---------------------------------------------------------------------------

export type BestEffortResult = {
  doc: EditableDoc;
  applied: Op[];
  dropped: Array<{ op: Op; error: string }>;
};

/** Apply ops one by one, silently dropping ops that no longer apply. */
export function applyOpsBestEffort(doc: EditableDoc, ops: readonly Op[]): BestEffortResult {
  let next = doc;
  const applied: Op[] = [];
  const dropped: Array<{ op: Op; error: string }> = [];
  for (const op of ops) {
    try {
      next = applyOps(next, [op]);
      applied.push(op);
    } catch (err) {
      dropped.push({ op, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { doc: next, applied, dropped };
}

// ---------------------------------------------------------------------------
// Drag index math + duplication + factories
// ---------------------------------------------------------------------------

/**
 * Final index (in the destination list *after* removal of the dragged item)
 * when hovering row `hoverIdx`'s top ("before") or bottom ("after") half in
 * the same list. `origIdx === hoverIdx` is a no-op (stays put).
 */
export function computeMoveIndex(origIdx: number, hoverIdx: number, before: boolean): number {
  if (origIdx === hoverIdx) return origIdx;
  const j = hoverIdx > origIdx ? hoverIdx - 1 : hoverIdx;
  return before ? j : j + 1;
}

/** Deep-clone a block subtree, minting fresh ids for every node. */
export function cloneWithNewIds(block: Block, makeId: () => string = newId): Block {
  return {
    ...block,
    id: makeId(),
    props: structuredCloneIfNeeded(block.props),
    children: block.children?.map((c) => cloneWithNewIds(c, makeId)),
  };
}

function structuredCloneIfNeeded(props: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === "function") return structuredClone(props);
  return JSON.parse(JSON.stringify(props)) as Record<string, unknown>;
}

/** Duplicate `id`: returns an insert op placing the clone right after the original. */
export function duplicateBlockOp(
  doc: EditableDoc,
  id: string,
  makeId: () => string = newId,
): { op: Op; clone: Block } {
  const found = findBlock(doc.body.blocks, id);
  if (!found) throw new OpError("NOT_FOUND", `duplicate: ${id} not found`);
  const parent = found.trail.length > 0 ? (found.trail[found.trail.length - 1] ?? null) : null;
  const clone = cloneWithNewIds(found.block, makeId);
  return {
    op: { op: "block.insert", parentId: parent?.id ?? null, index: found.index + 1, block: clone },
    clone,
  };
}

export function emptyBody(type: DocumentType): DocumentBody {
  return {
    schemaVersion: 1,
    type,
    theme: {
      tokens: { ...DEFAULT_THEME_TOKENS },
      fontHeading: "Inter",
      fontBody: "Inter",
      radius: "md",
    },
    settings: {
      seo: {},
      locale: "en",
      progressBar: true,
      autoAdvance: true,
      showBranding: true,
      captcha: false,
      notifyEmails: [],
    },
    blocks: [],
    endings: [],
    logic: { rules: [] },
  };
}

// ---------------------------------------------------------------------------
// Nested prop access for dot-path keys ("cta.label")
// ---------------------------------------------------------------------------

export function getDeep(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Returns a nested patch object so path "cta.label" becomes `{ cta: { label: v } }`. */
export function setDeep(path: string, value: unknown): Record<string, unknown> {
  const segments = path.split(".");
  const root: Record<string, unknown> = {};
  let cur = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === undefined) break;
    if (i === segments.length - 1) {
      cur[seg] = value;
    } else {
      const next: Record<string, unknown> = {};
      cur[seg] = next;
      cur = next;
    }
  }
  return root;
}
