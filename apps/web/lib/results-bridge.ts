// INTEGRATION-DEBT: awaiting T06/T14
//
// `@formforge/schema` (packages/schema) is still an empty stub while T06 runs in
// parallel, so T15 declares the minimal structural types it needs from spec §7
// right here. This file must stay the ONLY bridge: everything else in T15
// imports these types via `apps/web/lib/results/types.ts`.
//
// When T06 lands:
//   1. delete every definition below, and
//   2. replace with a single re-export:
//        export type { Block, DocumentBody } from "@formforge/schema";
//   3. fix any drift between these structural types and the real Zod schemas.
//
// NEVER edit packages/** from a ticket branch (hard rule #2 of W1).

/** Props are `Record<string, unknown>` at rest; each block kind narrows them. */
export type BlockProps = Record<string, unknown>;

/** spec §7 — `BlockBase` (structural only; real definition lives in @formforge/schema). */
export interface Block {
  id: string;
  kind: string;
  props: BlockProps;
  children?: Block[];
  hidden?: boolean;
}

/** spec §7 — `Theme` (structural only). */
export interface Theme {
  tokens: Record<string, string>;
  fontHeading?: string;
  fontBody?: string;
  radius?: "none" | "sm" | "md" | "lg" | "full";
}

/** spec §7 — `DocumentBody` (structural only). */
export interface DocumentBody {
  schemaVersion: 1;
  type: "form" | "page" | "portfolio";
  theme: Theme;
  settings: {
    seo?: {
      title?: string;
      description?: string;
      ogImageAssetId?: string;
    };
    locale?: string;
    progressBar?: boolean;
    autoAdvance?: boolean;
    showBranding?: boolean;
    captcha?: boolean;
    closeAt?: string;
    maxSubmissions?: number;
    notifyEmails?: string[];
  };
  blocks: Block[];
  endings?: Array<{
    id: string;
    title: string;
    body?: string;
    redirectUrl?: string;
  }>;
  logic?: { rules: unknown[] };
}
