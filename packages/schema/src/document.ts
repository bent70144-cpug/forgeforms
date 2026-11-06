// packages/schema — document body (spec §7). The heart of the product.
// OWNED BY T06 (issue #6).
import { z } from "zod";
import { Block } from "./block";
import { formatZodPath } from "./errors";
import { Rule } from "./rule";
import { DEFAULT_THEME, Theme } from "./theme";

export const DocumentSettings = z.object({
  seo: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      ogImageAssetId: z.string().optional(),
    })
    .default({}),
  locale: z.string().default("en"),
  progressBar: z.boolean().default(true),
  autoAdvance: z.boolean().default(true),
  showBranding: z.boolean().default(true),
  captcha: z.boolean().default(false),
  // SPEC-NOTE: spec shows `z.string().datetime()`; `z.iso.datetime()` is the
  // identical Zod 4 canonical form (same format, same error behavior).
  closeAt: z.iso.datetime().optional(),
  maxSubmissions: z.number().int().positive().optional(),
  // T29 (spec §17 GDPR): per-form retention — delete this form's completed
  // submission data older than N days. 0/undefined = keep forever (default).
  // Enforced by the core DraftValidator too (documents/validation.ts); the
  // worker's retention purge job reads it from the published snapshot.
  retentionDays: z.number().int().min(0).max(3650).optional(),
  // SPEC-NOTE: `z.email()` is the Zod 4 canonical form of `z.string().email()`.
  notifyEmails: z.array(z.email()).default([]),
  // T20 (spec §14.1.4): optional hidden-field extras beyond the standard UTM
  // set (the standard UTM params are always captured client-side). Canonical
  // home for the extension the logic builder's settings panel sends via the
  // `settings.update` op — see SettingsPatchSchema in src/ops.ts.
  hiddenFields: z
    .array(z.object({ name: z.string().min(1), label: z.string().optional() }))
    .optional(),
});

export const Ending = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().optional(),
  // SPEC-NOTE: `z.url()` is the Zod 4 canonical form of `z.string().url()`.
  redirectUrl: z.url().optional(),
});

const DocumentBodyBase = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(["form", "page", "portfolio"]),
  theme: Theme,
  settings: DocumentSettings,
  blocks: z.array(Block),
  endings: z.array(Ending).default([]),
  logic: z.object({ rules: z.array(Rule) }).default({ rules: [] }),
});

type DocumentBodyBase = z.output<typeof DocumentBodyBase>;

// SPEC-NOTE (ticket #6): block ids must be unique across the whole tree
// (including `children`). Enforced at the schema layer so corrupt documents are
// rejected on every parse, not only in the registry-aware validator.
function findDuplicateBlockIds(
  value: DocumentBodyBase,
): Array<{ path: PropertyKey[]; message: string }> {
  const duplicates: Array<{ path: PropertyKey[]; message: string }> = [];
  const seen = new Map<string, PropertyKey[]>();
  const walk = (blocks: readonly Block[], basePath: readonly PropertyKey[]) => {
    blocks.forEach((block, index) => {
      const blockPath: PropertyKey[] = [...basePath, index];
      const firstUsedAt = seen.get(block.id);
      if (firstUsedAt !== undefined) {
        duplicates.push({
          path: [...blockPath, "id"],
          message: `Duplicate block id "${block.id}" (first used at ${formatZodPath(firstUsedAt)})`,
        });
      } else {
        seen.set(block.id, blockPath);
      }
      if (block.children) walk(block.children, [...blockPath, "children"]);
    });
  };
  walk(value.blocks, ["blocks"]);
  return duplicates;
}

export const DocumentBody = DocumentBodyBase.check((ctx) => {
  for (const duplicate of findDuplicateBlockIds(ctx.value)) {
    ctx.issues.push({
      code: "custom",
      input: ctx.value,
      path: duplicate.path,
      message: duplicate.message,
    });
  }
});

export type DocumentSettings = z.infer<typeof DocumentSettings>;
export type Ending = z.infer<typeof Ending>;
export type DocumentBody = z.infer<typeof DocumentBody>;
export type DocumentType = DocumentBody["type"];

/** Create a minimal, fully-valid document body (builder "new document" default). */
export function createEmptyDocumentBody(type: DocumentType): DocumentBody {
  return DocumentBody.parse({
    schemaVersion: 1,
    type,
    theme: DEFAULT_THEME satisfies Theme,
    settings: {},
    blocks: [],
  });
}
