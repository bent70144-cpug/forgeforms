// Snapshot error classification → HTTP-ish semantics (spec §10: not-found → 404,
// unpublished/gone → 410). T10 owns the concrete AppError codes; this classifier
// matches the plausible spellings so the scroll route never misroutes a gone doc.

export type SnapshotErrorKind = "not-found" | "gone" | "unknown";

const NOT_FOUND_PATTERNS = ["not_found", "notfound", "missing", "no_such", "unknown_doc"] as const;

const GONE_PATTERNS = [
  "gone",
  "unpublished",
  "not_published",
  "notpublished",
  "unpublish",
  "draft",
  "archived",
  "deleted",
  "removed",
  "takedown",
] as const;

/**
 * Map an AppError.code to how the public plane should respond.
 * "unknown" (internal/transient reader errors) is intentionally NOT mapped to 410:
 * a storage blip must not imply the document is permanently gone.
 */
export function classifySnapshotError(code: unknown): SnapshotErrorKind {
  if (typeof code !== "string") return "unknown";
  const normalized = code.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (normalized === "") return "unknown";
  if (NOT_FOUND_PATTERNS.some((pattern) => normalized.includes(pattern))) return "not-found";
  if (GONE_PATTERNS.some((pattern) => normalized.includes(pattern))) return "gone";
  return "unknown";
}
