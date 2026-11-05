// Templates module types (spec §14.1.9, issue #22).
//
// SPEC-NOTE: `Result` / `AppError` / `Ctx` belong to the shared kernel in
// packages/core/src/shared/ (T02, in flight). They are re-declared here as
// structurally-compatible local types so the templates module stays self-contained;
// when T02 lands, the integrator should swap these imports 1:1 (see the W1-22
// integration report).

import type { DocumentBody, DocumentBodyInput } from "../bridge";

/** Error codes subset of the shared AppError (spec §4). */
export type AppError = {
  code: "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "FORBIDDEN" | "INTERNAL";
  message: string;
  details?: unknown;
};

/** Result envelope — services never throw across module boundaries (spec §3). */
export type Result<T, E = AppError> = { ok: true; data: T } | { ok: false; error: E };

/**
 * Context for services that touch tenant data (spec §3).
 * SPEC-NOTE: mirrors the shared `Ctx` shape; swap for the T02 type at integration.
 */
export type InstantiateCtx = {
  workspaceId: string;
  actor: { type: "user" | "token" | "mcp" | "system"; id: string };
  requestId: string;
  now: () => Date;
};

/** Gallery grouping — aligned 1:1 with the document `type` (spec §14.1.9). */
export type TemplateCategory = "form" | "page" | "portfolio";

/** Marketing/catalog metadata for a template (thumbnail is a CSS gradient, no images). */
export type TemplateMeta = {
  /** Stable id == public slug, e.g. "contact-form". */
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Finer-grained labels for the gallery filter chips, e.g. ["support", "sales"]. */
  tags: string[];
  /** Tailwind gradient utility classes for the thumbnail placeholder div. */
  gradient: string;
  /** Accent color (hex) used by the preview chrome. */
  accent: string;
};

/** A full template: catalog metadata + a valid DocumentBody payload. */
export type Template = {
  meta: TemplateMeta;
  body: DocumentBody;
};

/** Authoring shape stored in `data/` — validated against DocumentBody on load. */
export type TemplateDefinition = {
  meta: TemplateMeta;
  body: DocumentBodyInput;
};

/** Summary card shown by the gallery grid. */
export type TemplateSummary = TemplateMeta & {
  blockCount: number;
  questionCount: number;
  /** True when the template ships branching logic (spec §9 rules). */
  hasLogic: boolean;
};

/**
 * Payload returned by instantiateTemplate — the API layer (`POST /api/v1/documents`
 * with `{ type, title, templateId }`, spec §11) persists this as a new draft.
 */
export type NewDocumentPayload = {
  type: TemplateCategory;
  title: string;
  templateId: string;
  instantiatedBy: { workspaceId: string; actorType: string; actorId: string; requestId: string };
  body: DocumentBody;
};
