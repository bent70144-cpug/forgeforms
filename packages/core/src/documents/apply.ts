// T07 — server-side ops applier (spec §8 "Autosave (authoring)").
//
// The PATCH service (crud.ts) applies a batch of ops to the current draft in
// one transaction, then validates the result with a DraftValidator. This file
// is the pure, framework-free application step: no I/O, no Zod, no imports
// from @formforge/schema (core stays dependency-free — the *wire schema* for
// ops lives in packages/schema/src/ops.ts and is validated upstream).
//
// Semantics are identical to the client mirror (apps/web/lib/builder/ops.ts):
//  - patches are SHALLOW merges; a `null` value deletes the key;
//  - `block.move` index is the final position in the destination list AFTER
//    removing the moved item (same-list moves included);
//  - every failure throws DocOpError carrying the failing op index + a §4
//    detail path so the API can answer 422 with field-level errors.
//
// Server-only safety: `block.move` refuses to move a block into its own
// subtree (the client never generates this, and the guard keeps stored
// documents cycle-free).
import type { BlockJson, DocumentBodyJson, EndingJson } from './model';

/** Editable document handle the ops act on: body + document-level meta. */
export type OpDoc = {
  meta: { title: string; slug?: string };
  body: DocumentBodyJson;
};

/** The ops this module applies (structural mirror of @formforge/schema ops.ts). */
export type WireOp =
  | { op: 'block.insert'; parentId?: string | null; index: number; block: BlockJson }
  | { op: 'block.update'; id: string; props: Record<string, unknown> }
  | { op: 'block.move'; id: string; parentId?: string | null; index: number }
  | { op: 'block.remove'; id: string }
  | { op: 'settings.update'; patch: Record<string, unknown> }
  | { op: 'theme.update'; patch: Record<string, unknown> }
  | { op: 'ending.upsert'; ending: Record<string, unknown> }
  | { op: 'ending.remove'; id: string }
  | { op: 'rule.upsert'; rule: Record<string, unknown> }
  | { op: 'rule.remove'; id: string }
  | { op: 'meta.update'; patch: Record<string, unknown> };

export type DocOpErrorCode = 'NOT_FOUND' | 'BAD_INDEX' | 'INVALID';

/**
 * Application failure. `path` is the §4 detail path (e.g. `ops[3].id`),
 * `appCode` is always VALIDATION (spec §4: op failures are field-level 422s).
 */
export class DocOpError extends Error {
  constructor(
    public readonly code: DocOpErrorCode,
    message: string,
    public readonly opIndex: number,
    public readonly field: string,
  ) {
    super(message);
    this.name = 'DocOpError';
  }

  get path(): string {
    return `ops[${this.opIndex}]${this.field ? `.${this.field}` : ''}`;
  }

  get appCode(): 'VALIDATION' {
    return 'VALIDATION';
  }
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

type FoundBlock = {
  block: BlockJson;
  /** Ancestors outermost → innermost (excluding the block itself). */
  trail: BlockJson[];
  index: number;
};

function findBlock(list: readonly BlockJson[], id: string, trail: BlockJson[] = []): FoundBlock | null {
  for (let i = 0; i < list.length; i++) {
    const block = list[i];
    if (!block) continue;
    if (block.id === id) return { block, trail, index: i };
    if (block.children) {
      const found = findBlock(block.children, id, [...trail, block]);
      if (found) return found;
    }
  }
  return null;
}

function isDescendant(list: readonly BlockJson[], ancestorId: string, targetId: string): boolean {
  for (const block of list) {
    if (block.id === ancestorId) {
      return subtreeHasId(block, targetId);
    }
    if (block.children && isDescendant(block.children, ancestorId, targetId)) return true;
  }
  return false;
}

function subtreeHasId(block: BlockJson, id: string): boolean {
  if (block.id === id) return true;
  return (block.children ?? []).some((c) => subtreeHasId(c, id));
}

/** Children list of the trail's innermost element (root list when trail is empty). */
function leafList(body: DocumentBodyJson, trail: readonly BlockJson[]): BlockJson[] {
  if (trail.length === 0) return body.blocks;
  return trail[trail.length - 1]?.children ?? [];
}

/**
 * Return the root list with `newLeafList` installed as the children list of
 * `trail`'s innermost element (structural rebuild along the ancestor path).
 */
function rebuild(rootList: BlockJson[], trail: readonly BlockJson[], newLeafList: BlockJson[]): BlockJson[] {
  if (trail.length === 0) return newLeafList;
  const head = trail[0];
  if (!head) return rootList;
  return rootList.map((b) =>
    b.id === head.id ? { ...b, children: rebuild(b.children ?? [], trail.slice(1), newLeafList) } : b,
  );
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.round(index), length);
}

function fail(code: DocOpErrorCode, message: string, opIndex: number, field: string): never {
  throw new DocOpError(code, message, opIndex, field);
}

// ---------------------------------------------------------------------------
// Merge helpers (null deletes the key — see file header)
// ---------------------------------------------------------------------------

function mergeWithDelete(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

function patchWithout(patch: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _drop, ...rest } = patch;
  void _drop;
  return rest;
}

// ---------------------------------------------------------------------------
// Body ops
// ---------------------------------------------------------------------------

/** Apply a batch of body ops left-to-right; throws DocOpError on the first invalid op. */
export function applyBodyOps(body: DocumentBodyJson, ops: readonly WireOp[]): DocumentBodyJson {
  return applyDocOps({ meta: { title: '' }, body }, ops).body;
}

/** Apply ops to {meta, body}; `meta.update` touches meta, everything else the body. */
export function applyDocOps(doc: OpDoc, ops: readonly WireOp[]): OpDoc {
  let current = doc;
  for (let i = 0; i < ops.length; i++) {
    current = applyOne(current, ops[i]!, i);
  }
  return current;
}

function applyOne(doc: OpDoc, wireOp: WireOp, i: number): OpDoc {
  const op = wireOp as WireOp & Record<string, unknown>;
  switch (op.op) {
    case 'block.insert': {
      const parentId = op['parentId'] as string | null | undefined;
      const block = op['block'] as BlockJson;
      if (typeof block?.id !== 'string' || block.id.length === 0) {
        fail('INVALID', 'block.insert: block.id is required', i, 'block.id');
      }
      if (parentId) {
        const parent = findBlock(doc.body.blocks, parentId);
        if (!parent) fail('NOT_FOUND', `block.insert: parent block "${parentId}" not found`, i, 'parentId');
        const children = [...(parent!.block.children ?? [])];
        children.splice(clampIndex(op['index'] as number, children.length), 0, block);
        if (subtreeHasId(block, parentId)) {
          fail('INVALID', 'block.insert: cannot insert a block into its own subtree', i, 'parentId');
        }
        return setBlocks(doc, rebuild(doc.body.blocks, [...parent!.trail, parent!.block], children));
      }
      const blocks = [...doc.body.blocks];
      blocks.splice(clampIndex(op['index'] as number, blocks.length), 0, block);
      return setBlocks(doc, blocks);
    }

    case 'block.update': {
      const id = op['id'] as string;
      const found = findBlock(doc.body.blocks, id);
      if (!found) fail('NOT_FOUND', `block.update: block "${id}" not found`, i, 'id');
      const list = leafList(doc.body, found!.trail);
      const merged = list.map((b) =>
        b.id === id
          ? { ...b, props: mergeWithDelete({ ...(b.props ?? {}) }, op['props'] as Record<string, unknown>) }
          : b,
      );
      return setBlocks(doc, rebuild(doc.body.blocks, found!.trail, merged));
    }

    case 'block.move': {
      const id = op['id'] as string;
      const targetParentId = (op['parentId'] as string | null | undefined) ?? null;
      const found = findBlock(doc.body.blocks, id);
      if (!found) fail('NOT_FOUND', `block.move: block "${id}" not found`, i, 'id');
      const currentParentId = found!.trail.length > 0 ? found!.trail[found!.trail.length - 1]!.id : null;
      if (targetParentId && (targetParentId === id || isDescendant(doc.body.blocks, id, targetParentId))) {
        fail('INVALID', `block.move: cannot move "${id}" into its own subtree`, i, 'parentId');
      }
      // Step 1 — remove from the current location.
      const oldList = leafList(doc.body, found!.trail);
      const withoutBlock = oldList.filter((b) => b.id !== id);
      const body1 = setBlocks(doc, rebuild(doc.body.blocks, found!.trail, withoutBlock));
      // Step 2 — insert at the destination (index is final-position-after-removal).
      if (targetParentId === currentParentId) {
        const next = [...withoutBlock];
        next.splice(clampIndex(op['index'] as number, next.length), 0, found!.block);
        return setBlocks(body1, rebuild(body1.body.blocks, found!.trail, next));
      }
      if (targetParentId) {
        const dest = findBlock(body1.body.blocks, targetParentId);
        if (!dest) fail('NOT_FOUND', `block.move: parent block "${targetParentId}" not found`, i, 'parentId');
        const destList = [...(dest!.block.children ?? [])];
        destList.splice(clampIndex(op['index'] as number, destList.length), 0, found!.block);
        return setBlocks(body1, rebuild(body1.body.blocks, [...dest!.trail, dest!.block], destList));
      }
      const blocks = [...body1.body.blocks];
      blocks.splice(clampIndex(op['index'] as number, blocks.length), 0, found!.block);
      return setBlocks(body1, blocks);
    }

    case 'block.remove': {
      const id = op['id'] as string;
      const found = findBlock(doc.body.blocks, id);
      if (!found) fail('NOT_FOUND', `block.remove: block "${id}" not found`, i, 'id');
      const list = leafList(doc.body, found!.trail);
      return setBlocks(doc, rebuild(doc.body.blocks, found!.trail, list.filter((b) => b.id !== id)));
    }

    case 'settings.update': {
      const patch = op['patch'] as Record<string, unknown>;
      const settings = { ...(doc.body.settings as Record<string, unknown>) };
      const seoPatch = patch['seo'] as Record<string, unknown> | undefined;
      const rest = patchWithout(patch, 'seo');
      for (const [key, value] of Object.entries(rest)) {
        if (value === null) delete settings[key];
        else settings[key] = value;
      }
      settings['seo'] = seoPatch
        ? mergeWithDelete({ ...((doc.body.settings as Record<string, unknown>)['seo'] as Record<string, unknown> ?? {}) }, seoPatch)
        : settings['seo'];
      return { ...doc, body: { ...doc.body, settings: settings as DocumentBodyJson['settings'] } };
    }

    case 'theme.update': {
      const patch = op['patch'] as Record<string, unknown>;
      const theme = { ...(doc.body.theme as Record<string, unknown>) };
      const rest = patchWithout(patch, 'tokens');
      for (const [key, value] of Object.entries(rest)) {
        if (value === null) delete theme[key];
        else theme[key] = value;
      }
      const tokensPatch = patch['tokens'] as Record<string, string | null> | undefined;
      theme['tokens'] = tokensPatch
        ? mergeWithDelete({ ...((doc.body.theme as Record<string, unknown>)['tokens'] as Record<string, unknown>) }, tokensPatch)
        : theme['tokens'];
      return { ...doc, body: { ...doc.body, theme: theme as DocumentBodyJson['theme'] } };
    }

    case 'ending.upsert': {
      const ending = op['ending'] as { id: string } & Record<string, unknown>;
      if (typeof ending?.id !== 'string' || ending.id.length === 0) {
        fail('INVALID', 'ending.upsert: ending.id is required', i, 'ending.id');
      }
      const endings = [...(doc.body.endings ?? [])];
      const idx = endings.findIndex((e) => e.id === ending.id);
      const endingJson = ending as unknown as EndingJson;
      if (idx >= 0) endings[idx] = endingJson;
      else endings.push(endingJson);
      return { ...doc, body: { ...doc.body, endings } };
    }

    case 'ending.remove': {
      const id = op['id'] as string;
      return {
        ...doc,
        body: { ...doc.body, endings: (doc.body.endings ?? []).filter((e) => e.id !== id) },
      };
    }

    case 'rule.upsert': {
      const rule = op['rule'] as { id: string } & Record<string, unknown>;
      if (typeof rule?.id !== 'string' || rule.id.length === 0) {
        fail('INVALID', 'rule.upsert: rule.id is required', i, 'rule.id');
      }
      const rules = [...(doc.body.logic?.rules ?? [])] as Record<string, unknown>[];
      const idx = rules.findIndex((r) => r['id'] === rule.id);
      if (idx >= 0) rules[idx] = rule;
      else rules.push(rule);
      return { ...doc, body: { ...doc.body, logic: { rules: rules as unknown as NonNullable<DocumentBodyJson['logic']>['rules'] } } };
    }

    case 'rule.remove': {
      const id = op['id'] as string;
      return {
        ...doc,
        body: {
          ...doc.body,
          logic: { rules: ((doc.body.logic?.rules ?? []) as Record<string, unknown>[]).filter((r) => r['id'] !== id) as unknown as NonNullable<DocumentBodyJson['logic']>['rules'] },
        },
      };
    }

    case 'meta.update': {
      const patch = op['patch'] as Record<string, unknown>;
      const meta = { ...doc.meta };
      if ('title' in patch) {
        const title = patch['title'];
        if (typeof title !== 'string' || title.trim().length === 0) {
          fail('INVALID', 'meta.update: title must be a non-empty string', i, 'patch.title');
        }
        meta['title'] = title;
      }
      if ('slug' in patch) {
        const slug = patch['slug'];
        if (typeof slug !== 'string' || slug.trim().length === 0) {
          fail('INVALID', 'meta.update: slug must be a non-empty string', i, 'patch.slug');
        }
        meta['slug'] = slug;
      }
      return { ...doc, meta };
    }

    default:
      fail('INVALID', `Unknown op: ${JSON.stringify(wireOp)}`, i, 'op');
  }
}

function setBlocks(doc: OpDoc, blocks: BlockJson[]): OpDoc {
  return { ...doc, body: { ...doc.body, blocks } };
}
