/**
 * T10 — domain types for the publish pipeline (spec §6, §8).
 *
 * Persistence column naming follows spec §6 exactly: `documents.status` +
 * `documents.published_version_id` carry the publish state (SPEC-NOTE: the ticket
 * phrasing "current_version_id / published_at" is realized as these spec columns;
 * the lifecycle transitions are identical).
 */
import type { Ctx } from '../bridge';

export type DocumentType = 'form' | 'page' | 'portfolio';
export type DocumentStatus = 'draft' | 'published' | 'archived';

/** `documents` row per spec §6 (TS fields camelCase, DB columns snake_case). */
export type DocumentRecord = {
  id: string;
  workspaceId: string;
  type: DocumentType;
  title: string;
  slug: string;
  status: DocumentStatus;
  /** Optimistic concurrency counter — owned by T07 CRUD, untouched here. */
  rev: number;
  /** Current working body (DocumentBody JSON), spec §7. */
  draft: unknown;
  /** Version currently served publicly; null while draft. */
  publishedVersionId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Block node per spec §7 (structural minimum the snapshot builder needs). */
export type BlockJson = {
  id: string;
  kind: string;
  props?: Record<string, unknown>;
  children?: BlockJson[];
  hidden?: boolean;
};

export type EndingJson = {
  id: string;
  title: string;
  body?: string;
  redirectUrl?: string;
};

/** DocumentBody per spec §7 — structural minimum, validated by a DraftValidator. */
export type DocumentBodyJson = {
  schemaVersion: 1;
  type: DocumentType;
  theme: { tokens: Record<string, string>; fontHeading?: string; fontBody?: string; radius?: string };
  settings?: {
    seo?: { title?: string; description?: string; ogImageAssetId?: string };
    locale?: string;
    progressBar?: boolean;
    autoAdvance?: boolean;
    showBranding?: boolean;
    captcha?: boolean;
    closeAt?: string;
    maxSubmissions?: number;
    notifyEmails?: string[];
  };
  blocks: BlockJson[];
  endings?: EndingJson[];
  logic?: { rules: unknown[] };
};

/** `document_versions` row per spec §6 — immutable, insert-only. */
export type DocumentVersionRecord = {
  id: string;
  documentId: string;
  workspaceId: string;
  schemaVersion: number;
  /** Full DocumentBody snapshot JSON. Immutable once written. */
  body: unknown;
  createdBy: string | null;
  createdAt: Date;
};

/**
 * Snapshot per spec §8 (`snapshots.rendered`). Blocks are sanitized with asset
 * URLs resolved; routing is the compiled logic keyed by blockId.
 */
export type SnapshotSeo = { title?: string; description?: string; ogImageUrl?: string };

/** Compiled logic node per spec §9 — owned by the logic module; kept structural. */
export type RouteNode = { defaultNext?: string; rules?: readonly unknown[] };
export type Routing = Record<string, RouteNode>;

export type SnapshotSettings = {
  progressBar: boolean;
  autoAdvance: boolean;
  showBranding: boolean;
  captcha: boolean;
  closeAt?: string;
};

export type Snapshot = {
  documentId: string;
  versionId: string;
  type: DocumentType;
  title: string;
  seo: SnapshotSeo;
  locale: string;
  cssVars: Record<string, string>;
  blocks: BlockJson[];
  endings: EndingJson[];
  routing: Routing;
  settings: SnapshotSettings;
};

/** `snapshots` row per spec §6 (rendered = Snapshot JSON, addressed by etag). */
export type SnapshotRecord = {
  documentId: string;
  versionId: string;
  rendered: Snapshot;
  etag: string;
  builtAt: Date;
};

/** Outcome of a successful publish (issue #10: "return { url }"). */
export type PublishOutcome = {
  url: string;
  documentId: string;
  versionId: string;
  /** 1-based, monotonic position of this version in the document's history. */
  version: number;
  /** True when the draft body was unchanged and the previous version was reused. */
  reused: boolean;
};

/** What the public snapshot reader hands to renderers/ingest. */
export type PublishedSnapshot = {
  documentId: string;
  versionId: string;
  etag: string;
  /** Deep-frozen on read — treat as immutable (spec §6: rendered is immutable). */
  snapshot: Snapshot;
};

/** Context passed through the pipeline; re-exported for module consumers. */
export type { Ctx };
