// lib/builder/preview.ts — pure helpers for the §8.4 preview modal.
//
// Preview mounts the REAL conversational renderer against the CURRENT DRAFT
// (§8.4 "loads the draft as of now, not the published snapshot"). The publish
// pipeline (T10) builds the sanitized snapshot server-side; that builder is
// composition-root/server code, so this module replicates the minimal
// client-safe draft → renderer-document projection the renderer actually
// reads (SPEC-DEVIATION: deliberate client-side mapping, NOT a snapshot —
// nothing is persisted and no snapshot version is created).
//
// No React, no DOM — fully unit-testable (vitest node env). Type-only import
// of the renderer props keeps the heavy conversational bundle out of this
// module (§13: the renderer is lazy-loaded by the modal, never statically).

import type { ConversationalRendererProps } from "@formforge/renderer/conversational";
import type { DocumentBody } from "../bridge";
import type { DocMeta } from "./ops";

/** The conversational renderer's own lenient document type (spec §8 fields). */
export type PreviewDocument = ConversationalRendererProps["document"];

/** Everything `ConversationalRenderer` needs for one preview session. */
export type PreviewInput = {
  documentId: string;
  document: PreviewDocument;
  /** Prefill URL params (spec §7.2 `prefillParam`) parsed from the toolbar. */
  urlParams: Record<string, string>;
};

/** §8.4 device toggle. */
export type PreviewDevice = "desktop" | "mobile";

/**
 * Device frame widths for the preview stage (§8.4). `null` = fluid: the
 * renderer fills the modal stage; mobile constrains to a 390px phone frame.
 */
export const PREVIEW_DEVICE_WIDTHS: Record<PreviewDevice, number | null> = {
  desktop: null,
  mobile: 390,
};

/**
 * Parse a prefill query string from the preview toolbar (§8.4 "prefill via
 * editable URL params shown in the preview toolbar").
 *
 * Accepts `?email=test@x.io&name=Ada` or `email=test@x.io&name=Ada`:
 * - a single leading `?` is stripped;
 * - `%XX` escapes and `+` (form-urlencoded space) are decoded;
 * - malformed pairs are ignored silently (no `=`, or an empty key); a pair
 *   whose escapes are invalid (`k=%ZZ`) keeps its raw text instead of throwing;
 * - a repeated key: last occurrence wins (`URLSearchParams` + `Object.fromEntries` semantics).
 */
export function parsePrefillParams(search: string): Record<string, string> {
  const raw = search.trim();
  if (raw === "") return {};
  const query = raw.startsWith("?") ? raw.slice(1) : raw;
  const out: Record<string, string> = {};
  if (query === "") return out;
  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue; // no "=" or empty key → malformed, ignored
    const key = decodeParamPart(pair.slice(0, eq));
    if (key === "") continue;
    out[key] = decodeParamPart(pair.slice(eq + 1));
  }
  return out;
}

function decodeParamPart(part: string): string {
  const plusDecoded = part.replace(/\+/g, " ");
  try {
    return decodeURIComponent(plusDecoded);
  } catch {
    // Malformed escape (e.g. "%ZZ") — keep the raw text, never throw.
    return plusDecoded;
  }
}

/**
 * Map the current draft ({meta, body}) onto the conversational renderer's
 * input (§8.4: real renderer, draft as of now).
 *
 * - `documentId` prefers the slug so sandbox traces read like the public
 *   plane; preview ingest is the sandbox mock, so the id is cosmetic.
 * - `document.title` comes from the envelope-level meta (the schema body
 *   carries no title field).
 * - Only the settings the renderer reads are projected — server-only extras
 *   (seo, notifyEmails, retentionDays, hiddenFields) never reach it.
 */
export function buildPreviewInput(
  body: DocumentBody,
  meta: DocMeta,
  urlParams: Record<string, string>,
): PreviewInput {
  return {
    documentId: meta.slug && meta.slug !== "" ? meta.slug : "draft-preview",
    document: toRendererDocument(body, meta),
    urlParams,
  };
}

/** Client-safe projection: schema DocumentBody → renderer document. */
function toRendererDocument(body: DocumentBody, meta: DocMeta): PreviewDocument {
  return {
    schemaVersion: 1,
    type: body.type,
    title: meta.title !== "" ? meta.title : undefined,
    theme: body.theme
      ? {
          tokens: { ...body.theme.tokens },
          fontHeading: body.theme.fontHeading,
          fontBody: body.theme.fontBody,
          radius: body.theme.radius,
        }
      : undefined,
    settings: {
      locale: body.settings?.locale,
      progressBar: body.settings?.progressBar,
      autoAdvance: body.settings?.autoAdvance,
      showBranding: body.settings?.showBranding,
      captcha: body.settings?.captcha,
      closeAt: body.settings?.closeAt,
      maxSubmissions: body.settings?.maxSubmissions,
    },
    blocks: body.blocks,
    endings: body.endings,
    logic: { rules: body.logic?.rules ?? [] },
  };
}
