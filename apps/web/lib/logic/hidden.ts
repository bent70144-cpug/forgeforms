// Hidden fields (UTM capture) + per-question prefill (spec §14.1.4 / §7.2 /
// §10.3). Pure helpers shared by the builder UI and the public-plane wiring.
//
// SPEC-NOTE: spec §7's DocumentBody has no hidden-fields config field; the
// standard UTM parameter set below is the §14.1.4 "hidden fields (UTM capture)"
// config. An optional per-document extension list rides in
// `settings.hiddenFields` via the `settings.update` op (client-side type in
// lib/bridge.ts). TODO(merge): align with T07's DocumentSettings schema — if
// T07 strips unknown settings keys, persist the extension list in the logic
// panel state instead and keep capture client-side only.

import type { Block, DocumentBody } from "../bridge";

/** Standard UTM capture set (spec §14.1.4 "hidden fields (UTM capture)"). */
export const DEFAULT_HIDDEN_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export type HiddenFieldConfig = { name: string; label?: string };

/** Effective hidden-field config: standard UTM set + any configured extras. */
export function hiddenFieldConfig(body: DocumentBody): HiddenFieldConfig[] {
  const configured = body.settings?.hiddenFields;
  const extras = Array.isArray(configured)
    ? configured
        .filter((f): f is HiddenFieldConfig => f !== null && typeof f === "object" && typeof (f as HiddenFieldConfig).name === "string")
        .filter((f) => !(DEFAULT_HIDDEN_FIELDS as readonly string[]).includes(f.name))
    : [];
  return [
    ...DEFAULT_HIDDEN_FIELDS.map((name) => ({ name })),
    ...extras,
  ];
}

/**
 * Captures hidden-field values from URL search params (spec §10.3 start:
 * `hidden: { utm_source: "x", … }`). Only params the config lists are taken;
 * empty values are dropped. Last value wins for repeated params.
 */
export function captureHiddenFields(
  params: URLSearchParams | Record<string, string>,
  body?: DocumentBody,
): Record<string, unknown> {
  const entries =
    params instanceof URLSearchParams
      ? [...params.entries()]
      : Object.entries(params);
  const names = new Set(hiddenFieldConfig(body ?? EMPTY_BODY).map((f) => f.name));
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!names.has(key)) continue;
    if (value === "") continue;
    out[key] = value;
  }
  return out;
}

/**
 * Per-question prefill (spec §7.2: every question block supports the generic
 * `prefillParam` prop): maps URL params → draft answers, keyed by blockId.
 * Only questions with a configured `prefillParam` and a matching non-empty
 * param are prefilled.
 */
export function prefillAnswers(
  body: DocumentBody,
  params: URLSearchParams | Record<string, string>,
): Record<string, unknown> {
  const get = (name: string): string | undefined =>
    params instanceof URLSearchParams ? (params.get(name) ?? undefined) : params[name];
  const out: Record<string, unknown> = {};
  for (const block of body.blocks ?? []) {
    collectPrefill([block], get, out);
  }
  return out;
}

function collectPrefill(
  blocks: readonly Block[],
  get: (name: string) => string | undefined,
  out: Record<string, unknown>,
): void {
  for (const block of blocks) {
    if (!block || typeof block.id !== "string") continue;
    const param = block.props["prefillParam"];
    if (typeof param === "string" && param !== "") {
      const value = get(param);
      if (value !== undefined && value !== "") out[block.id] = value;
    }
    if (Array.isArray(block.children)) collectPrefill(block.children, get, out);
  }
}

const EMPTY_BODY: DocumentBody = {
  schemaVersion: 1,
  type: "form",
  theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
  settings: { seo: {}, locale: "en", progressBar: true, autoAdvance: true, showBranding: true, captcha: false, notifyEmails: [] },
  blocks: [],
  endings: [],
  logic: { rules: [] },
};
