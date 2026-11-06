// packages/schema — documents ops vocabulary (spec §8 "Autosave (authoring)").
// OWNED BY T07 (issue #7); consumed by the documents PATCH service (core),
// the builder autosave client (apps/web) and the logic builder (T20).
//
// Client sends PATCH /api/v1/documents/:id with `{ baseRev, ops: Op[] }`.
// The server applies the ops in one transaction against `documents.draft`,
// validates the result with `DocumentBody` and increments `rev` (409 CONFLICT
// when `baseRev` is stale).
//
// Merge-patch convention (server + client parity, mirrors apps/web/lib/builder):
//  - object patches are SHALLOW merges into the current value;
//  - a `null` value DELETES the key (e.g. `tokens: { "color.bg": null }`,
//    `closeAt: null`) — plain objects never store nulls in normal editing;
//  - array-valued fields (notifyEmails) are replaced wholesale (send [] to clear).
import { z } from "zod";
import { Block } from "./block";
import { Ending } from "./document";
import { Rule } from "./rule";

// ---------------------------------------------------------------------------
// Patches (null = delete key)
// ---------------------------------------------------------------------------

/** theme.update — partial theme; token values may be null to remove a token. */
export const ThemePatchSchema = z
  .object({
    tokens: z.record(z.string(), z.string().nullable()),
    fontHeading: z.string().min(1),
    fontBody: z.string().min(1),
    radius: z.enum(["none", "sm", "md", "lg", "full"]),
  })
  .partial();

/** settings.update — partial settings; nullable fields reset to unset/default. */
export const SettingsPatchSchema = z
  .object({
    seo: z
      .object({
        title: z.string().nullable(),
        description: z.string().nullable(),
        ogImageAssetId: z.string().nullable(),
      })
      .partial(),
    locale: z.string().min(1),
    progressBar: z.boolean(),
    autoAdvance: z.boolean(),
    showBranding: z.boolean(),
    captcha: z.boolean(),
    // SPEC-NOTE: `z.iso.datetime()` is the Zod 4 form of spec §7's `z.string().datetime()`.
    closeAt: z.iso.datetime().nullable(),
    maxSubmissions: z.number().int().positive().nullable(),
    notifyEmails: z.array(z.email()),
    // T20 (spec §14.1.4): hidden-field extras — array-replaced wholesale like
    // notifyEmails (send [] to clear); the canonical DocumentSettings schema
    // (src/document.ts) owns the stored shape.
    hiddenFields: z.array(z.object({ name: z.string().min(1), label: z.string().optional() })),
  })
  .partial();

/**
 * meta.update — document-level metadata (title/slug), not the body.
 * PARTIAL on purpose: the autosave queue may send just the field that changed
 * (e.g. an inline title edit without a slug change); the server merges the
 * patch shallowly and enforces workspace-unique slugs itself. Constraints
 * still apply whenever a field IS present (trim + non-empty + ≤300).
 */
export const MetaPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    slug: z.string().min(1).max(300),
  })
  .partial();

// ---------------------------------------------------------------------------
// Op union (spec §8)
// ---------------------------------------------------------------------------

export const BlockInsertOpSchema = z.object({
  op: z.literal("block.insert"),
  parentId: z.string().min(1).nullish(),
  index: z.number().int().min(0),
  block: Block,
});

export const BlockUpdateOpSchema = z.object({
  op: z.literal("block.update"),
  id: z.string().min(1),
  // Shallow merge into props; a null value deletes the key (see header).
  props: z.record(z.string(), z.unknown()),
});

export const BlockMoveOpSchema = z.object({
  op: z.literal("block.move"),
  id: z.string().min(1),
  parentId: z.string().min(1).nullish(),
  // Final position in the destination list AFTER removal of the moved item.
  index: z.number().int().min(0),
});

export const BlockRemoveOpSchema = z.object({
  op: z.literal("block.remove"),
  id: z.string().min(1),
});

export const SettingsUpdateOpSchema = z.object({
  op: z.literal("settings.update"),
  patch: SettingsPatchSchema,
});

export const ThemeUpdateOpSchema = z.object({
  op: z.literal("theme.update"),
  patch: ThemePatchSchema,
});

export const EndingUpsertOpSchema = z.object({
  op: z.literal("ending.upsert"),
  ending: Ending,
});

export const EndingRemoveOpSchema = z.object({
  op: z.literal("ending.remove"),
  id: z.string().min(1),
});

export const RuleUpsertOpSchema = z.object({
  op: z.literal("rule.upsert"),
  rule: Rule,
});

export const RuleRemoveOpSchema = z.object({
  op: z.literal("rule.remove"),
  id: z.string().min(1),
});

export const MetaUpdateOpSchema = z.object({
  op: z.literal("meta.update"),
  patch: MetaPatchSchema,
});

export const DocumentOpSchema = z.discriminatedUnion("op", [
  BlockInsertOpSchema,
  BlockUpdateOpSchema,
  BlockMoveOpSchema,
  BlockRemoveOpSchema,
  SettingsUpdateOpSchema,
  ThemeUpdateOpSchema,
  EndingUpsertOpSchema,
  EndingRemoveOpSchema,
  RuleUpsertOpSchema,
  RuleRemoveOpSchema,
  MetaUpdateOpSchema,
]);

export type BlockInsertOp = z.infer<typeof BlockInsertOpSchema>;
export type BlockUpdateOp = z.infer<typeof BlockUpdateOpSchema>;
export type BlockMoveOp = z.infer<typeof BlockMoveOpSchema>;
export type BlockRemoveOp = z.infer<typeof BlockRemoveOpSchema>;
export type SettingsUpdateOp = z.infer<typeof SettingsUpdateOpSchema>;
export type ThemeUpdateOp = z.infer<typeof ThemeUpdateOpSchema>;
export type EndingUpsertOp = z.infer<typeof EndingUpsertOpSchema>;
export type EndingRemoveOp = z.infer<typeof EndingRemoveOpSchema>;
export type RuleUpsertOp = z.infer<typeof RuleUpsertOpSchema>;
export type RuleRemoveOp = z.infer<typeof RuleRemoveOpSchema>;
export type MetaUpdateOp = z.infer<typeof MetaUpdateOpSchema>;
export type DocumentOp = z.infer<typeof DocumentOpSchema>;
export type ThemePatch = z.infer<typeof ThemePatchSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
export type MetaPatch = z.infer<typeof MetaPatchSchema>;

// ---------------------------------------------------------------------------
// PATCH request body (spec §8 + §11)
// ---------------------------------------------------------------------------

export const PatchDocumentOpsSchema = z.object({
  baseRev: z.number().int().min(0),
  ops: z.array(DocumentOpSchema),
});

export type PatchDocumentOps = z.infer<typeof PatchDocumentOpsSchema>;
