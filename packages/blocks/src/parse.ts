// packages/blocks — strict, registry-aware document parsing (ticket #6).
// OWNED BY T06 (issue #6).
import { validateDocumentBody, type ValidateDocumentResult } from "@formforge/schema";
import { registeredKindSchemas } from "./registry";

/**
 * Parse a stored document body strictly: DocumentBody shape + duplicate ids
 * (schema layer), then unknown kinds and per-kind props validation (registry
 * layer) with field-level error paths like `blocks[2].props.title` (spec §4).
 */
export function parseDocument(input: unknown): ValidateDocumentResult {
  return validateDocumentBody(input, registeredKindSchemas());
}
