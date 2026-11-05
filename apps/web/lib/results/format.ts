// T15 — block introspection + answer formatting (pure, tested).
// Question labels always come from the document snapshot (spec §14.1.5),
// never from stored answers.

import type { Block } from "../results-bridge";
import { displayCell } from "./labels";

/** spec §7.2 — question kinds the MVP registry defines. */
export const QUESTION_KINDS = [
  "short-text",
  "long-text",
  "email",
  "number",
  "single-select",
  "multi-select",
  "dropdown",
  "rating",
  "nps",
  "file-upload",
] as const;

export type QuestionKind = (typeof QUESTION_KINDS)[number];

const QUESTION_KIND_SET: ReadonlySet<string> = new Set(QUESTION_KINDS);

/** Kinds whose aggregate renders as a choice distribution. */
const CHOICE_KINDS: ReadonlySet<string> = new Set(["single-select", "multi-select", "dropdown"]);

const EMPTY = "—";

export function isQuestionBlock(block: Block): boolean {
  return QUESTION_KIND_SET.has(block.kind);
}

export function isChoiceKind(kind: string): boolean {
  return CHOICE_KINDS.has(kind);
}

function propsOf(block: Block): Record<string, unknown> {
  return block.props ?? {};
}

function stringProp(block: Block, key: string): string | undefined {
  const value = propsOf(block)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberProp(block: Block, key: string): number | undefined {
  const value = propsOf(block)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export interface OptionLike {
  id: string;
  label: string;
}

/** Narrow `props.options` (spec §7.2 choice blocks) into safe option pairs. */
export function optionsOf(block: Block): OptionLike[] {
  const raw = propsOf(block).options;
  if (!Array.isArray(raw)) return [];
  const out: OptionLike[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.id === "string" && typeof rec.label === "string") {
      out.push({ id: rec.id, label: rec.label });
    }
  }
  return out;
}

export function optionLabel(block: Block, optionId: string): string | undefined {
  return optionsOf(block).find((o) => o.id === optionId)?.label;
}

/** Question label from the snapshot; falls back to kind + id, never throws. */
export function questionLabel(block: Block): string {
  return (
    stringProp(block, "label") ??
    stringProp(block, "title") ??
    `Untitled ${block.kind} (${block.id})`
  );
}

/** Rating scale (3–10 per spec §7.2); anything invalid falls back to 5. */
export function ratingScaleOf(block: Block): number {
  const scale = numberProp(block, "scale");
  if (scale === undefined) return 5;
  return Math.min(10, Math.max(3, Math.round(scale)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True when the stored answer carries no information. */
export function isEmptyAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return true;
    return keys.every((k) => {
      const v = value[k];
      if (k === "optionIds" || k === "assetIds") return Array.isArray(v) && v.length === 0;
      return v === null || v === undefined || v === "";
    });
  }
  return false;
}

function formatOptionAnswer(block: Block, value: Record<string, unknown>): string {
  const other = value.other;
  if (typeof other === "string") {
    const trimmed = other.trim();
    return trimmed.length > 0 ? `Other: ${trimmed}` : "Other";
  }
  const optionId = value.optionId ?? value.id;
  if (typeof optionId === "string") {
    return optionLabel(block, optionId) ?? optionId;
  }
  return EMPTY;
}

function formatMultiSelectAnswer(block: Block, value: Record<string, unknown>): string {
  const ids = value.optionIds;
  if (!Array.isArray(ids) || ids.length === 0) return EMPTY;
  const labels = ids
    .filter((id): id is string => typeof id === "string")
    .map((id) => optionLabel(block, id) ?? id);
  return labels.length > 0 ? labels.join(", ") : EMPTY;
}

function formatFileAnswer(value: Record<string, unknown>): string {
  const ids = value.assetIds;
  const count = Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string").length
    : 0;
  return count === 1 ? "1 file" : `${count} files`;
}

/**
 * Human string for a stored answer, given the block for label lookups.
 * Empty/unparsable answers render as "—" (spec §14.1.5).
 */
export function formatAnswer(block: Block, value: unknown): string {
  if (isEmptyAnswer(value)) return EMPTY;
  if (typeof value === "string") return displayCell(value, 120);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  if (Array.isArray(value)) {
    return value.length === 0 ? EMPTY : displayCell(value.map(String).join(", "), 120);
  }
  if (isRecord(value)) {
    switch (block.kind) {
      case "single-select":
      case "dropdown":
        return formatOptionAnswer(block, value);
      case "multi-select":
        return formatMultiSelectAnswer(block, value);
      case "file-upload":
        return formatFileAnswer(value);
      default:
        return EMPTY;
    }
  }
  return EMPTY;
}

/** Numeric answer for aggregation, or null when the answer isn't that number. */
export function numericAnswer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Format an ISO timestamp as UTC (`6 Nov 2026, 14:05 UTC`).
 * Fixed locale/timezone so server and client render identically (no hydration
 * drift) — spec §4 stores all timestamps as UTC.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(
    d.getUTCHours(),
  ).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** Relative-ish short form for table cells: `6 Nov, 14:05`. */
export function formatDateTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

/** Format a 0–100 percent for cards/badges. */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
