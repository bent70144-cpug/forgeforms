// ISSUE #30: the structural spec §7 copies (Block, Theme, DocumentBody) were
// retired — @formforge/schema (T06) is the single source of truth, exactly as
// this file's original swap plan prescribed. Consumers keep importing from
// here (`apps/web/lib/results/types.ts` funnels these into the results plane).
export type { Block, DocumentBody } from "@formforge/schema";
