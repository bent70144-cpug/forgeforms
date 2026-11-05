// Authoring helpers for seed templates. They produce plain `DocumentBodyInput`
// objects (spec §7); every template is still validated against the full
// `DocumentBody` schema in tests and at instantiation time.
import type {
  BlockInput,
  DocumentBodyInput,
  EndingInput,
  RuleInput,
  ThemeInput,
} from "../../bridge";

type ThemeOverrides = {
  bg?: string;
  fg?: string;
  primary?: string;
  primaryFg?: string;
  muted?: string;
  border?: string;
  fontHeading?: string;
  fontBody?: string;
  radius?: "none" | "sm" | "md" | "lg" | "full";
};

export const FONTS = {
  sans: "Inter",
  serif: "Fraunces",
  mono: "IBM Plex Mono",
} as const;

/** Document theme (spec §7 `Theme`). Tokens map to `--ff-*` CSS variables (§14.3). */
export function theme(o: ThemeOverrides): ThemeInput {
  return {
    tokens: {
      "color.bg": o.bg ?? "#ffffff",
      "color.fg": o.fg ?? "#0f172a",
      "color.primary": o.primary ?? "#4f46e5",
      "color.primaryFg": o.primaryFg ?? "#ffffff",
      "color.muted": o.muted ?? "#64748b",
      "color.border": o.border ?? "#e2e8f0",
    },
    ...(o.fontHeading ? { fontHeading: o.fontHeading } : {}),
    ...(o.fontBody ? { fontBody: o.fontBody } : {}),
    ...(o.radius ? { radius: o.radius } : {}),
  };
}

type SettingsOverrides = {
  seoTitle?: string;
  seoDescription?: string;
  progressBar?: boolean;
  autoAdvance?: boolean;
  showBranding?: boolean;
  captcha?: boolean;
  maxSubmissions?: number;
  notifyEmails?: string[];
};

/** Document settings (spec §7 `settings`); inner fields have schema defaults. */
export function settings(o: SettingsOverrides): DocumentBodyInput["settings"] {
  return {
    ...(o.seoTitle || o.seoDescription
      ? { seo: { ...(o.seoTitle ? { title: o.seoTitle } : {}), ...(o.seoDescription ? { description: o.seoDescription } : {}) } }
      : {}),
    ...(o.progressBar === undefined ? {} : { progressBar: o.progressBar }),
    ...(o.autoAdvance === undefined ? {} : { autoAdvance: o.autoAdvance }),
    ...(o.showBranding === undefined ? {} : { showBranding: o.showBranding }),
    ...(o.captcha === undefined ? {} : { captcha: o.captcha }),
    ...(o.maxSubmissions === undefined ? {} : { maxSubmissions: o.maxSubmissions }),
    ...(o.notifyEmails === undefined ? {} : { notifyEmails: o.notifyEmails }),
  };
}

/** A single block (spec §7 `BlockBase`). Ids are template-local and stable. */
export function block(
  id: string,
  kind: string,
  props: Record<string, unknown>,
  children?: BlockInput[],
): BlockInput {
  return { id, kind, props, ...(children ? { children } : {}) };
}

/** Selectable options for single/multi-select and dropdown blocks. */
export function options(blockId: string, labels: string[]): { id: string; label: string }[] {
  return labels.map((label, i) => ({ id: `${blockId}-o${i + 1}`, label }));
}

/** Common generic question props (spec §7.2 note under the catalog). */
export function question(
  id: string,
  kind: string,
  props: Record<string, unknown>,
): BlockInput {
  return block(id, kind, { required: true, ...props });
}

/** An ending screen (spec §7 `endings`). */
export function ending(id: string, title: string, body?: string): EndingInput {
  return { id, title, ...(body ? { body } : {}) };
}

/** Logic condition operand, e.g. cond("@block:nps1", "lte", 6). */
export function cond(
  left: string,
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "isEmpty" | "matches",
  right?: unknown,
): RuleInput["when"][number] {
  return { left, op, ...(right === undefined ? {} : { right }) };
}

/** goto action. `target` is a blockId or "end:<endingId>" (spec §9). */
export function goto(target: string): RuleInput["then"][number] {
  return { type: "goto", target };
}

export function setVar(name: string, value: unknown): RuleInput["then"][number] {
  return { type: "set", var: name, value };
}

/**
 * A logic rule (spec §7 `Rule`).
 * SPEC-NOTE: `isFallback` has a schema default, so it is only set when true.
 */
export function rule(
  id: string,
  scope: string,
  when: RuleInput["when"],
  then: RuleInput["then"],
  isFallback = false,
): RuleInput {
  return { id, scope, when, then, ...(isFallback ? { isFallback: true } : {}) };
}

/** Full DocumentBody input with opinionated defaults for theme/settings. */
export function doc(
  type: DocumentBodyInput["type"],
  bodyTheme: ThemeInput,
  blocks: BlockInput[],
  o: {
    settings?: DocumentBodyInput["settings"];
    endings?: EndingInput[];
    rules?: RuleInput[];
  } = {},
): DocumentBodyInput {
  return {
    schemaVersion: 1,
    type,
    theme: bodyTheme,
    settings: o.settings ?? settings({}),
    blocks,
    ...(o.endings ? { endings: o.endings } : {}),
    ...(o.rules ? { logic: { rules: o.rules } } : {}),
  };
}
