// Prompt building blocks shared by draft and edit flows.
// The cheatsheet is the machine-readable restatement of spec §7.2 so the
// model can only emit block kinds that actually exist in the registry.
import { BLOCK_KIND_CHEATSHEET, KNOWN_BLOCK_KINDS } from "../bridge";

export const AI_JSON_CONTRACT = [
  "Output ONLY a single JSON value. No prose, no markdown fences, no commentary.",
  "Every block needs: id (unique short id), kind (from the cheatsheet), props (object).",
  "Never invent block kinds, prop names or enum values outside the cheatsheet.",
].join(" ");

export function blockKindCheatsheet(): string {
  const lines = BLOCK_KIND_CHEATSHEET.map(
    (b) => `- ${b.kind} (${b.family}): ${b.props}`,
  );
  return [
    "BLOCK KIND CHEATSHEET — use ONLY these kinds:",
    ...lines,
    "Every question block also supports generic props: description, required, buttonText, imageAssetId, prefillParam.",
  ].join("\n");
}

/**
 * Extracts the first JSON value from a model reply. Tolerates markdown code
 * fences and surrounding prose, because "retry once" is cheaper than failing
 * on a stray ```json fence.
 */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  for (const candidate of [unfenced, trimmed]) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // fall through to brace slicing
    }
  }
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return { ok: true, value: JSON.parse(unfenced.slice(start, end + 1)) };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

/** Renders zod issues as the spec §4 field-level detail shape. */
export function zodIssuesToDetails(issues: Array<{ path: PropertyKey[]; message: string }>): Array<{
  path: string;
  message: string;
}> {
  return issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

export { KNOWN_BLOCK_KINDS };
