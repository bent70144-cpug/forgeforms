// Templates service (issue #22, spec §14.1.9 + M6).
//
// Public interface (see ./index.ts):
//   listTemplates()                          — gallery metadata, no bodies
//   getTemplate(templateId)                  — full template, deep-frozen
//   instantiateTemplate(ctx, templateId, o?) — "Use template": fresh-id, deep-cloned
//                                              document payload for the documents API
//                                              to persist as a draft (spec §11).
//
// SPEC-NOTE: spec §14.1.9 stores templates at `packages/core/src/documents/templates/`;
// W1-22's file-ownership map assigns `packages/core/src/templates/**` instead (the
// documents/ module is owned by another ticket in the same wave). The integrator can
// move the folder or keep this path — `instantiateTemplate` is the only contract.
import { DocumentBody, type Block } from "../bridge";
import { createBlockId } from "./ids";
import { templateRegistry } from "./data";
import type {
  InstantiateCtx,
  NewDocumentPayload,
  Result,
  Template,
  TemplateCategory,
  TemplateSummary,
} from "./types";

/** Question-family block kinds (spec §7.2) — used for gallery stats. */
const QUESTION_KINDS = new Set([
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deepFreeze((value as any)[key]);
    }
  }
  return value;
}

function walkBlocks(blocks: readonly Block[], visit: (b: Block) => void): void {
  for (const b of blocks) {
    visit(b);
    if (b.children) walkBlocks(b.children, visit);
  }
}

/** Gallery listing with lightweight stats. Cheap: no bodies are attached. */
export function listTemplates(options?: { category?: TemplateCategory; tag?: string }): TemplateSummary[] {
  return templateRegistry
    .filter((t) => (options?.category ? t.meta.category === options.category : true))
    .filter((t) => (options?.tag ? t.meta.tags.includes(options.tag) : true))
    .map((t) => {
      let blockCount = 0;
      let questionCount = 0;
      walkBlocks(t.body.blocks, (b) => {
        blockCount += 1;
        if (QUESTION_KINDS.has(b.kind)) questionCount += 1;
      });
      const { id, name, description, category, tags, gradient, accent } = t.meta;
      return {
        id,
        name,
        description,
        category,
        tags,
        gradient,
        accent,
        blockCount,
        questionCount,
        hasLogic: (t.body.logic?.rules?.length ?? 0) > 0,
      };
    });
}

/**
 * Full template by id (== slug). The returned object is deep-frozen —
 * use `instantiateTemplate` to obtain a mutable, workspace-owned copy.
 */
export function getTemplate(templateId: string): Template | null {
  const def = templateRegistry.find((t) => t.meta.id === templateId);
  if (!def) return null;
  const parsed = DocumentBody.safeParse(def.body);
  if (!parsed.success) return null; // CI (templates.test.ts) guarantees this never happens
  return deepFreeze({ meta: deepFreeze({ ...def.meta }), body: parsed.data });
}

export type InstantiateOptions = {
  /** Override the document title (defaults to the template name). */
  title?: string;
};

/**
 * "Use template" — produces the payload for creating a new draft document
 * (`POST /api/v1/documents` with `{ type, title, templateId }`, spec §11).
 *
 * Guarantees:
 *  - deep clone: mutating the result never affects the catalog or other instances;
 *  - fresh ids: every block (recursively) and every ending gets a new id, and all
 *    logic references (`scope`, `@block:<id>` operands, `goto` targets incl.
 *    `end:<endingId>`) are remapped to the fresh ids;
 *  - the remapped body is re-validated against `DocumentBody` before returning.
 */
export function instantiateTemplate(
  ctx: InstantiateCtx,
  templateId: string,
  options?: InstantiateOptions,
): Result<NewDocumentPayload> {
  const def = templateRegistry.find((t) => t.meta.id === templateId);
  if (!def) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Unknown template: ${templateId}`,
        details: { templateId },
      },
    };
  }

  // 1. Validate, then deep-clone the parsed body (mutation safety) and collect old ids.
  const source = DocumentBody.safeParse(def.body);
  if (!source.success) {
    // Programmer error: seed templates are schema-validated in CI (templates.test.ts).
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: `Template ${templateId} does not validate against DocumentBody`,
        details: source.error.issues.slice(0, 20),
      },
    };
  }
  const body = structuredClone(source.data);

  const blockIdMap = new Map<string, string>();
  const collect = (blocks: Block[]): void => {
    for (const b of blocks) {
      blockIdMap.set(b.id, createBlockId());
      if (b.children) collect(b.children);
    }
  };
  collect(body.blocks);

  const endingIdMap = new Map<string, string>();
  for (const e of body.endings ?? []) endingIdMap.set(e.id, createBlockId());

  const remapBlockId = (oldId: string): string => blockIdMap.get(oldId) ?? oldId;
  const remapOperand = (left: string): string => {
    // "@block:<id>" | "@var:<name>" | "@hidden:<name>" (spec §9)
    if (left.startsWith("@block:")) return `@block:${remapBlockId(left.slice("@block:".length))}`;
    return left;
  };
  const remapGotoTarget = (target: string): string => {
    if (target.startsWith("end:")) {
      const oldEnding = target.slice("end:".length);
      const mapped = endingIdMap.get(oldEnding);
      return mapped ? `end:${mapped}` : target;
    }
    return remapBlockId(target);
  };

  // 2. Regenerate ids in place on the private clone.
  const reid = (blocks: Block[]): void => {
    for (const b of blocks) {
      b.id = remapBlockId(b.id);
      if (b.children) reid(b.children);
    }
  };
  reid(body.blocks);
  for (const e of body.endings ?? []) e.id = endingIdMap.get(e.id) ?? e.id;

  for (const r of body.logic?.rules ?? []) {
    r.scope = r.scope === "start" ? r.scope : remapBlockId(r.scope);
    r.when = r.when.map((w) => ({ ...w, left: remapOperand(w.left) }));
    r.then = r.then.map((action) =>
      action.type === "goto" ? { ...action, target: remapGotoTarget(action.target) } : action,
    );
  }

  // 3. Validate the remapped result against the DocumentBody schema (spec §7).
  const parsed = DocumentBody.safeParse(body);
  if (!parsed.success) {
    // Programmer error: seed templates are schema-validated in CI (templates.test.ts).
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: `Template ${templateId} produced an invalid document after instantiation`,
        details: parsed.error.issues.slice(0, 20),
      },
    };
  }

  return {
    ok: true,
    data: {
      type: parsed.data.type,
      title: options?.title ?? def.meta.name,
      templateId: def.meta.id,
      instantiatedBy: {
        workspaceId: ctx.workspaceId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.id,
        requestId: ctx.requestId,
      },
      body: parsed.data,
    },
  };
}
