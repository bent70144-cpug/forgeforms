// packages/blocks — `file-upload` props + answer schema (T16, spec §7.2 row:
// "label, accept[], maxSizeMb(≤10), maxFiles | { assetIds: string[] }").
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";
import type { UrlParams } from "../shared/prefill";

/**
 * Hard ceiling for the file-upload block (spec §7.2: "maxSizeMb(≤10)").
 * NOTE for maintainers: @formforge/core/assets pins the matching server-side
 * ceiling (`MAX_FILE_UPLOAD_BLOCK_MB`, spec §13 free/pro cap). Keep the two
 * in sync — business-plan sizes (50 MB) are a server entitlement (§13), never
 * a block setting: answers still flow through the SAME 10 MB-block ceiling.
 */
export const FILE_UPLOAD_BLOCK_MAX_MB = 10;

/** Accept-list entries: `<mime>` ("image/png"), `<ext>` (".pdf"), or `mime/*`. */
export const AcceptEntry = z
  .string()
  .min(1)
  .max(100)
  .regex(/^\.?[A-Za-z0-9][A-Za-z0-9.+\-/]*$/, "accept entries must be mime types or file extensions");

export const FileUploadProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
  /** Allowed file types; empty = any type the server allowlist accepts. */
  accept: z.array(AcceptEntry).max(20).default([]),
  /** Per-file cap in MB — always ≤ 10 (spec §7.2). */
  maxSizeMb: z.number().int().min(1).max(FILE_UPLOAD_BLOCK_MAX_MB).default(10),
  /** How many files may be attached (answer assetIds cap). */
  maxFiles: z.number().int().min(1).max(10).default(1),
});

export type FileUploadProps = z.infer<typeof FileUploadProps>;

// §7.2 "Answer value: { assetIds: string[] }" — ids returned by the upload
// plane (POST /api/public/uploads/confirm) and resolved to signed URLs at
// render time. Asset ids are opaque strings (uuid or ast_-prefixed short id).
export const FileUploadAnswer = z.object({
  assetIds: z.array(z.string().min(1).max(200)),
});

export type FileUploadAnswer = z.infer<typeof FileUploadAnswer>;

export function validateFileUpload(
  answer: FileUploadAnswer,
  props: FileUploadProps,
): string | null {
  const ids = Array.isArray(answer?.assetIds) ? answer.assetIds : [];
  if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
    return "Invalid asset reference";
  }
  if (new Set(ids).size !== ids.length) {
    return "Duplicate files are not allowed";
  }
  if (ids.length > props.maxFiles) {
    return `Attach at most ${props.maxFiles} file${props.maxFiles === 1 ? "" : "s"}`;
  }
  if (props.required && ids.length === 0) {
    return "This field is required";
  }
  return null;
}

/** Editor helper: the `<input accept>` attribute value for the block props. */
export function acceptAttributeValue(accept: readonly string[]): string {
  return accept.join(",");
}

export function fileUploadDefaultProps(): FileUploadProps {
  return {
    label: "Upload a file",
    accept: [],
    maxSizeMb: 10,
    maxFiles: 1,
    required: false,
  };
}

/**
 * Prefill: file answers are never prefilled from URL params (uploading a file
 * requires the presign dance; a URL param cannot carry bytes). Present for
 * registry symmetry with the other question blocks.
 */
export function prefillFileUpload(
  _props: FileUploadProps,
  _params: UrlParams,
): FileUploadAnswer | undefined {
  return undefined;
}
