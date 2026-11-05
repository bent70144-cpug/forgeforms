// packages/schema — registry-aware document validation (spec §7 + ticket #6).
// OWNED BY T06 (issue #6).
//
// `DocumentBody` alone accepts any `kind` string (spec §7): the registry decides
// which kinds exist. This validator takes a map of kind → propsSchema and
// enforces the strict layer on top: unknown kinds rejected, props validated per
// kind, field-level error paths like `blocks[2].props.title` (spec §4).
//
// packages/blocks calls this with the live registry (`parseDocument`); API/ingest
// code can call it directly with any kind→schema map.
import { z } from "zod";
import { documentIssuesFromZodError, type DocumentIssue } from "./errors";
// `DocumentBody` is both a value (schema) and a type (same-name declaration).
import { DocumentBody } from "./document";

export type KindSchemaMap = Readonly<Record<string, z.ZodType<unknown>>>;

export type ValidateDocumentResult =
  | { ok: true; data: DocumentBody }
  | { ok: false; issues: DocumentIssue[] };

function collectBlockIssues(
  blocks: readonly DocumentBody["blocks"][number][],
  basePath: string,
  kindSchemas: KindSchemaMap,
  issues: DocumentIssue[],
): void {
  blocks.forEach((block, index) => {
    const blockPath = `${basePath}[${index}]`;
    const propsSchema = kindSchemas[block.kind];
    if (propsSchema === undefined) {
      issues.push({
        path: `${blockPath}.kind`,
        message: `Unknown block kind "${block.kind}"`,
      });
    } else {
      const props = propsSchema.safeParse(block.props);
      if (!props.success) {
        for (const issue of props.error.issues) {
          const relative = issue.path.map(String).join(".");
          // We deliberately re-format with the `blocks[i].props.` prefix rather
          // than formatZodPath so the path is anchored to the document root.
          if (issue.code === "unrecognized_keys" && "keys" in issue && Array.isArray(issue.keys) && issue.keys.length > 0) {
            // Zod 4 reports unrecognized keys on the containing object with an
            // empty path; expand them into field-level paths instead.
            for (const key of issue.keys) {
              issues.push({
                path: relative === "" ? `${blockPath}.props.${String(key)}` : `${blockPath}.props.${relative}.${String(key)}`,
                message: `Unrecognized prop "${String(key)}"`,
              });
            }
            continue;
          }
          issues.push({
            path: relative === "" ? `${blockPath}.props` : `${blockPath}.props.${relative}`,
            message: issue.message,
          });
        }
      }
    }
    if (block.children && block.children.length > 0) {
      collectBlockIssues(block.children, `${blockPath}.children`, kindSchemas, issues);
    }
  });
}

/**
 * Strictly validate a document body against a map of block kind → propsSchema.
 *
 * Order of checks: `DocumentBody` shape first (schemaVersion, ids, duplicate
 * ids, settings, theme, logic); then per-block kind/props checks with paths
 * anchored at the document root (`blocks[2].props.title`).
 */
export function validateDocumentBody(
  input: unknown,
  kindSchemas: KindSchemaMap,
): ValidateDocumentResult {
  const shape = DocumentBody.safeParse(input);
  if (!shape.success) {
    return { ok: false, issues: documentIssuesFromZodError(shape.error) };
  }
  const issues: DocumentIssue[] = [];
  collectBlockIssues(shape.data.blocks, "blocks", kindSchemas, issues);
  if (issues.length === 0) {
    return { ok: true, data: shape.data };
  }
  return { ok: false, issues };
}
