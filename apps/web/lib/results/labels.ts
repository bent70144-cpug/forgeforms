// T15 — display-safe truncation + CSV-safe cell helpers (pure, tested).
// Reused by the submissions table, the detail drawer and (later) the CSV
// export job so every surface truncates and sanitizes identically.

const ELLIPSIS = "…";

/**
 * Truncate a label to `max` characters (including the ellipsis).
 * Collapses surrounding whitespace first. `max < 1` yields the ellipsis only.
 */
export function truncateLabel(label: string, max = 48): string {
  const clean = label.trim();
  if (max < 1) return ELLIPSIS;
  if (clean.length <= max) return clean;
  if (max === 1) return ELLIPSIS;
  const cut = Math.max(1, max - ELLIPSIS.length);
  return clean.slice(0, cut).trimEnd() + ELLIPSIS;
}

/**
 * Make an arbitrary answer string safe for a single CSV cell:
 * - control characters and CR/LF collapsed to single spaces (one physical row),
 * - double quotes doubled (`""`) so any quoting writer stays correct,
 * - leading formula triggers (`= + - @ \t`) neutralized with a `'` prefix
 *   (CSV-injection guard, OWASP guidance),
 * - truncated to `max` characters.
 */
export function csvSafeCell(raw: string, max = 280): string {
  const singleLine = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const escaped = singleLine.replace(/"/g, '""');
  const guarded = /^[=+\-@\t]/.test(escaped) ? `'${escaped}` : escaped;
  return truncateLabel(guarded, max);
}

/**
 * Truncate a value for display in a tight table cell. Newlines become
 * " ⏎ " so multi-line answers stay on one visual line with a hint.
 */
export function displayCell(raw: string, max = 64): string {
  const singleLine = raw.replace(/\r?\n/g, " ⏎ ").replace(/\s+/g, " ").trim();
  return truncateLabel(singleLine, max);
}
