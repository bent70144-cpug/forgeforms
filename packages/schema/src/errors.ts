// packages/schema — error helpers (spec §4 error body format).
// OWNED BY T06 (issue #6).
//
// API error details carry field-level paths like `blocks[2].props.title`:
//   { "error": { "code": "VALIDATION", "message": "Invalid input",
//                "details": [{ "path": "blocks[2].props.title", "message": "Required" }] } }
import type { z } from "zod";

export type DocumentIssue = {
  /** Dot/bracket path, e.g. `blocks[2].props.title` (spec §4). */
  path: string;
  message: string;
};

/** Format a Zod issue path as the string form used by the API error body. */
export function formatZodPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else if (typeof segment === "string") {
      out += out === "" ? segment : `.${segment}`;
    } else {
      // Symbol or exotic keys — bracket-quote them so the path stays unambiguous.
      out += `[${JSON.stringify(String(segment))}]`;
    }
  }
  return out;
}

/** Map a ZodError onto the spec §4 `details` shape. */
export function documentIssuesFromZodError(error: z.ZodError): DocumentIssue[] {
  return error.issues.map((issue) => ({
    path: formatZodPath(issue.path),
    message: issue.message,
  }));
}
