// T18 (issue #18) — pure CSV builder (spec §12 `exports`/`csv-export`).
//
// RFC 4180 rules implemented here:
//   - fields containing `,` `"` CR or LF are wrapped in double quotes;
//   - embedded double quotes are escaped by doubling;
//   - records are terminated with CRLF;
//   - a UTF-8 BOM is emitted once, before the header row (Excel compatibility).
//
// Spreadsheet formula injection (OWASP "CSV Injection"): a cell whose first
// character is one of = + - @ TAB CR is prefixed with a single quote so Excel &
// friends treat it as text, not a formula. The ticket mandates this for =/+/-/@;
// TAB/CR are included per the OWASP cheat sheet.
//
// This module is 100% pure: no I/O, no clock, no randomness. Streaming takes an
// (async) iterable of rows and yields one string chunk per record.

/** UTF-8 byte-order mark, emitted once before the header row (Excel). */
export const CSV_BOM = "﻿";

/** RFC 4180 record separator. */
export const CSV_EOL = "\r\n";

/**
 * A CSV column. `id` is the stable key used to look up the value in each row
 * (for question blocks this is the block id, so headers survive label edits);
 * `header` is the text written to the header row (defaults to `id`).
 */
export interface CsvColumn {
  readonly id: string;
  readonly header?: string;
}

/**
 * Quotes/escapes a single cell per RFC 4180. Plain cells pass through
 * untouched; risky cells are wrapped and their embedded quotes doubled.
 */
export function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Neutralises spreadsheet formula injection: prefixes a leading = + - @ TAB CR
 * with a single quote (OWASP). Only the first character is inspected — a value
 * like "abc=1" mid-string is left alone.
 */
export function sanitizeCsvFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Default value formatter for arbitrary answer JSON:
 * null/undefined → "", string → as-is, number/boolean → String(),
 * Date → ISO-8601, array → "; "-joined items, other objects → JSON.
 */
export function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => formatCsvValue(item)).join("; ");
  return JSON.stringify(value);
}

export type BuildCsvInput = {
  /** Columns in the exact order they must appear in the output. */
  columns: readonly CsvColumn[];
  /** Row values keyed by column id; missing keys render as empty cells. Extra keys are ignored. */
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>;
  /** Cell formatter override (e.g. answer-aware label resolution in service.ts). */
  formatCell?: (value: unknown, column: CsvColumn) => string;
  /** Formula-injection guard, on by default (ticket requirement). */
  sanitizeFormulas?: boolean;
};

/**
 * Streaming CSV generator: first chunk is BOM + header row, then exactly one
 * chunk (a full CRLF-terminated record) per row. Memory stays bounded by a
 * single record regardless of export size.
 */
export async function* buildCsvStream(input: BuildCsvInput): AsyncGenerator<string> {
  const { columns, rows, formatCell = formatCsvValue, sanitizeFormulas = true } = input;
  const header = columns.map((column) => escapeCsvCell(column.header ?? column.id)).join(",");
  yield CSV_BOM + header + CSV_EOL;
  for await (const row of rows) {
    const cells = columns.map((column) => {
      const raw = formatCell(row[column.id], column);
      return escapeCsvCell(sanitizeFormulas ? sanitizeCsvFormula(raw) : raw);
    });
    yield cells.join(",") + CSV_EOL;
  }
}

/** Convenience wrapper: renders the whole CSV to a single string (tests, small exports). */
export async function buildCsvToString(input: BuildCsvInput): Promise<string> {
  let out = "";
  for await (const chunk of buildCsvStream(input)) out += chunk;
  return out;
}
