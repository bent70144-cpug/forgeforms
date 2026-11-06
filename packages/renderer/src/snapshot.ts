// packages/renderer/src/snapshot.ts — public-plane snapshot contract (spec §8).
//
// ISSUE #30: moved from the retired src/bridge.ts. The renderer deliberately
// keeps a LENIENT local snapshot type (spec fields optional) instead of
// importing @formforge/core: the renderer is shipped to the browser (≤120KB
// client budget) and must not pull the server kernel into the bundle. Every
// consumer handles absent fields, so publish-side drift stays compatible.
//
// The snapshot reader is injectable: apps/web configures the REAL reader at
// composition time via `configureSnapshotReader()` (wired to T10's publish
// pipeline / the db snapshots repo). Until configured, the default reader
// fails visibly (mapped to 404 + server-side console.error) and never throws.

/** Block as stored in the published snapshot (spec §7 Block, post-sanitize). */
export type SnapshotBlock = {
  id?: string;
  kind?: string;
  props?: Record<string, unknown>;
  children?: SnapshotBlock[];
  hidden?: boolean;
};

/** Ending as stored in the published snapshot (spec §7 endings). */
export type SnapshotEnding = {
  id?: string;
  title?: string;
  body?: string;
  redirectUrl?: string;
};

/** SEO fields resolved onto the snapshot (spec §7 settings.seo + §8). */
export type SnapshotSeo = {
  title?: string;
  description?: string;
  ogImageAssetId?: string;
  /** T10 resolves ogImageAssetId → CDN URL; accept either spelling. */
  ogImageUrl?: string;
  ogImage?: string;
};

export type SnapshotSettings = {
  progressBar?: boolean;
  autoAdvance?: boolean;
  showBranding?: boolean;
  captcha?: boolean;
  closeAt?: string;
};

export type SnapshotType = "form" | "page" | "portfolio";

/** Published snapshot (spec §8 `snapshots.rendered`). */
export type Snapshot = {
  documentId?: string;
  versionId?: string;
  type?: SnapshotType;
  title?: string;
  seo?: SnapshotSeo;
  locale?: string;
  /** Theme resolved to CSS variables by the snapshot builder (e.g. "--ff-bg": "#fbf9f4"). */
  cssVars?: Record<string, string>;
  blocks?: SnapshotBlock[];
  endings?: SnapshotEnding[];
  routing?: Record<string, unknown>;
  settings?: SnapshotSettings;
};

/** Minimal AppError shape (spec §3: services return Result<T, AppError>). */
export type AppError = {
  code: string;
  message: string;
  details?: unknown;
};

/** Result type from the shared kernel (spec §3). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type GetPublishedSnapshot = (slug: string) => Promise<Result<Snapshot, AppError>>;

/**
 * Placeholder reader — ALWAYS fails until the host app configures the real
 * reader via `configureSnapshotReader()`. The scroll route maps the failure to
 * a 404 with a server-side console.error, so a missing integration fails
 * visibly but never crashes the public plane.
 */
const notImplementedReader: GetPublishedSnapshot = async () => ({
  ok: false,
  error: {
    code: "NOT_IMPLEMENTED",
    message:
      "getPublishedSnapshot placeholder — no snapshot reader configured. " +
      "The host app must call configureSnapshotReader() at composition time " +
      "(issue #30 follow-up wires apps/web).",
  },
});

let reader: GetPublishedSnapshot = notImplementedReader;

/** Composition-root hook: install the real snapshot reader (idempotent). */
export function configureSnapshotReader(next: GetPublishedSnapshot): void {
  reader = next;
}

/** Snapshot reader used by the public render planes (spec §10.1). */
export const getPublishedSnapshot: GetPublishedSnapshot = (key) => reader(key);
