// Publish gate (builder spec §7.5 draft-vs-published, §8.1 validation levels,
// §4 Publish button states, §22.1 publish endpoint contract).
//
// PURE module — no React, no DOM. Fully unit-tested in publish.test.ts.
//
// Two sources of issues are combined:
// 1. THE CANONICAL SCHEMA VALIDATOR — `validateDocumentBody(body,
//    registeredKindSchemas())` from @formforge/schema + @formforge/blocks.
//    It reports `{ path, message }` issues WITHOUT stable §8.1 codes, so each
//    schema issue is classified into the closest §8.1 code where the path
//    allows it (label/options/notifyEmails/redirectUrl/href); everything else
//    keeps the generic `SCHEMA` code with the raw validator message.
// 2. CLIENT-SIDE SUPPLEMENTS — §8.1 rules the schema validator does not
//    express (option count/uniqueness, document-level NO_QUESTIONS /
//    NO_ENDING, plan file-size limit, unsafe button/ending URLs, bad
//    notification emails, sensitive-field warnings via @formforge/core's
//    publish-time scanner, and the logic linter's dangling/cycle diagnostics
//    reused from @formforge/core/logic — the same lint the publish pipeline
//    runs server-side). Every supplement below is marked with a
//    "client-side supplement" comment at its check.
//
// SERVER-ONLY CODES — FORM_EMBED_MISSING + MISSING_ASSET (B7 follow-up #4):
// neither is collectible client-side (the builder loads no document index or
// asset index, so embed-target status and asset existence are unknowable in
// the browser). They are emitted by the server publish pipeline
// (@formforge/core documents: collectEmbedTargetIssues + the snapshot asset
// walk) with stable codes + blockId on the §4 422 details; PublishControl
// merges that list into the drawer via mergeIssues, so both codes block
// publish and group by block like every local code.
//
// Never blocks autosave: field/block-level validation is display-only
// (§8.1 "Field… never blocks autosave"); this module only feeds UI.

import { validateDocumentBody } from "@formforge/schema";
import { registeredKindSchemas, safeHref } from "@formforge/blocks";
import { lint } from "@formforge/core/logic";
// Deep subpath import (NOT the @formforge/core barrel): this module runs in
// the browser, and the barrel pulls in node:crypto-dependent identity/billing
// modules, which breaks the client webpack build (§19: one-line justification).
import { scanSensitiveFields } from "@formforge/core/documents/sensitive-fields";
import type { Block, DocumentBody } from "../bridge";
import { getBlockMeta } from "./blockMeta";

// ---------------------------------------------------------------------------
// Issue shape + stable codes (spec §8.1 table)
// ---------------------------------------------------------------------------

/**
 * UI-facing validation issue. `level: "warning"` issues (SENSITIVE_FIELD)
 * are NOT publish-blocking (§8.1 "warning, not blocking").
 */
export type ValidationIssue = {
  /** Stable §8.1 code (or `SCHEMA` / `LOGIC` / `SERVER` for unmapped ones). */
  code: string;
  message: string;
  /** Owning block id; `null` = document-level issue. */
  blockId: string | null;
  /** Validator path, e.g. `blocks[2].props.label` (spec §4 detail shape). */
  path?: string;
  level: "error" | "warning";
};

/** §8.1 publish-blocking codes. */
export const ISSUE_CODES = {
  emptyLabel: "EMPTY_LABEL",
  noOptions: "NO_OPTIONS",
  dupOption: "DUP_OPTION",
  badRange: "BAD_RANGE",
  fileTooLarge: "FILE_TOO_LARGE",
  noQuestions: "NO_QUESTIONS",
  noEnding: "NO_ENDING",
  logicDangling: "LOGIC_DANGLING",
  logicCycle: "LOGIC_CYCLE",
  badUrl: "BAD_URL",
  badEmail: "BAD_EMAIL",
  // B7 follow-up #4 — SERVER-ONLY codes (no client-side supplement):
  // FORM_EMBED_MISSING and MISSING_ASSET are cross-entity rules only the
  // publish service can evaluate (the builder loads no document index or
  // asset index client-side, so target-document and asset existence are
  // unknowable in the browser). The server emits them with `blockId` on the
  // §4 422 `details` (packages/core documents pipeline, PUBLISH_ISSUE_CODES);
  // wireIssueToValidationIssue parses them below and IssuesList groups them
  // by block exactly like local issues. The constants live here so the
  // client-side vocabulary matches the wire (tests pin both sides).
  formEmbedMissing: "FORM_EMBED_MISSING",
  missingAsset: "MISSING_ASSET",
  // Warning (non-blocking):
  sensitiveField: "SENSITIVE_FIELD",
  // Fallbacks for issues without a §8.1 mapping:
  schema: "SCHEMA",
  logic: "LOGIC",
  server: "SERVER",
} as const;

/** §8.3/§17: the note shown next to SENSITIVE_FIELD warnings. */
export const ABUSE_POLICY_NOTE =
  "FormForge must not be used to collect regulated secrets (card numbers, passwords, government ids) — use a dedicated PCI/HIPAA-compliant collector instead.";

/** FILE_TOO_LARGE plan limit (§8.1: "maxSizeMb > plan limit (10 default)"). */
export const FILE_UPLOAD_PLAN_LIMIT_MB = 10;

/** Kinds the §8.1 select rules apply to (≥ 2 non-empty, unique options). */
const SELECT_KINDS: ReadonlySet<string> = new Set(["single-select", "multi-select", "dropdown"]);

/** Save states that mean "the draft has changes not on the server" (§7.5). */
const UNPUBLISHED_SAVE_STATES: ReadonlySet<string> = new Set([
  "dirty",
  "saving",
  "offline",
  "error",
  "conflict",
]);

export type SaveStatusLike = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error" | "offline";

// ---------------------------------------------------------------------------
// collectIssues
// ---------------------------------------------------------------------------

/**
 * Full publish-gate validation for a document body (§8.1 document level).
 * Deterministic order: schema issues (block order), block supplements
 * (depth-first document order), document-level checks, sensitive-field
 * warnings, logic lint. Deduped by `code|blockId|path` — the schema result
 * wins over an equivalent client-side supplement.
 */
export function collectIssues(body: DocumentBody): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Canonical schema validation (registry-aware — packages/blocks schemas).
  const schemaResult = validateDocumentBody(body, registeredKindSchemas());
  const schemaIssues: ValidationIssue[] =
    schemaResult.ok === true
      ? []
      : schemaResult.issues.map((issue) => classifySchemaIssue(issue.path, issue.message, body));
  issues.push(...schemaIssues);

  const covered = new Set(
    schemaIssues.map((i) => `${i.code}|${i.blockId ?? ""}|${i.path ?? ""}`),
  );
  const add = (issue: ValidationIssue): void => {
    const key = `${issue.code}|${issue.blockId ?? ""}|${issue.path ?? ""}`;
    if (covered.has(key)) return;
    covered.add(key);
    issues.push(issue);
  };

  // 2. Per-block client-side supplements (depth-first, document order).
  walkBlocks(body.blocks, "blocks", (block, path) => {
    collectBlockIssues(block, path, add);
  });

  // 3. Document-level checks.
  collectDocumentIssues(body, add);

  // 4. Sensitive-field warnings (non-blocking, §8.1/§17 — same scanner the
  // server runs at publish time, so local and server lists agree).
  for (const warning of scanSensitiveFields(body)) {
    add({
      code: ISSUE_CODES.sensitiveField,
      message: warning.message,
      blockId: warning.blockId ?? null,
      level: "warning",
    });
  }

  // 5. Logic lint — mirrored from the server pipeline (apps/web/lib/api/
  // logic-compiler.ts): only when the draft is structurally valid, and only
  // error-severity diagnostics block (§9 "compile-time lint blocks publish").
  if (schemaIssues.length === 0) {
    const endingIds = (body.endings ?? []).map((ending) => ending.id);
    const diagnostics = lint(
      body.logic?.rules ?? [],
      body.blocks,
      endingIds,
    );
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity !== "error") continue; // warnings never block
      const code =
        diagnostic.code === "dangling_goto"
          ? ISSUE_CODES.logicDangling
          : diagnostic.code === "cycle_no_exit"
            ? ISSUE_CODES.logicCycle
            : ISSUE_CODES.logic;
      add({
        code,
        message: diagnostic.ruleId
          ? `rule "${diagnostic.ruleId}": ${diagnostic.message}`
          : diagnostic.message,
        blockId: diagnostic.blockId ?? null,
        path: diagnostic.ruleId ? `logic.rules.${diagnostic.ruleId}` : `logic.${diagnostic.blockId ?? "rules"}`,
        level: "error",
      });
    }
  }

  return issues;
}

/** True when the issue does NOT block publishing (§8.1 warning level). */
export function isBlocking(issue: ValidationIssue): boolean {
  return issue.level === "error";
}

/** Number of publish-blocking issues (what the "Fix N issues" button counts). */
export function blockingCount(issues: readonly ValidationIssue[]): number {
  return issues.filter(isBlocking).length;
}

// --- schema issue classification -------------------------------------------

/**
 * Map the canonical validator's `{ path, message }` issue onto the closest
 * §8.1 code. Only unambiguous path shapes are classified; the rest stay
 * `SCHEMA` (the raw validator message is displayed either way).
 */
function classifySchemaIssue(path: string, message: string, body: DocumentBody): ValidationIssue {
  const blockId = blockIdFromDocPath(path, body.blocks);
  let code: string = ISSUE_CODES.schema;
  if (/\.label$/.test(path)) {
    code = ISSUE_CODES.emptyLabel;
  } else if (/\.props\.options/.test(path)) {
    code = ISSUE_CODES.noOptions;
  } else if (/notifyEmails/.test(path)) {
    code = ISSUE_CODES.badEmail;
  } else if (/\.props\.href$/.test(path) || /redirectUrl$/.test(path)) {
    code = ISSUE_CODES.badUrl;
  }
  return { code, message, blockId, path, level: "error" };
}

/**
 * Resolve `blocks[1].children[0].props.title` → the block's id (or null).
 * Numeric indexes follow the same depth-first bracket notation the schema
 * validator emits.
 */
export function blockIdFromDocPath(
  path: string,
  blocks: readonly Block[],
): string | null {
  const matches = [...path.matchAll(/\[(\d+)\]/g)].map((m) => Number.parseInt(m[1] ?? "", 10));
  if (!/^blocks(\.|$|\[)/.test(path) || matches.length === 0) return null;
  let list: readonly Block[] = blocks;
  let node: Block | undefined;
  for (const index of matches) {
    node = list[index];
    if (node === undefined) return null;
    list = node.children ?? [];
  }
  return node?.id ?? null;
}

// --- per-block supplements (client-side) -----------------------------------

function walkBlocks(
  blocks: readonly Block[],
  basePath: string,
  visit: (block: Block, path: string) => void,
): void {
  blocks.forEach((block, index) => {
    const path = `${basePath}[${index}]`;
    visit(block, path);
    if (block.children && block.children.length > 0) {
      walkBlocks(block.children, `${path}.children`, visit);
    }
  });
}

function collectBlockIssues(block: Block, path: string, add: (issue: ValidationIssue) => void): void {
  const props = block.props as Record<string, unknown>;

  // EMPTY_LABEL — client-side supplement (§8.1): the schema catches invalid
  // labels, but a mid-edit draft can hold an absent/blank label that the
  // block's editor declares (same heuristic as the tree badge in BlocksTree).
  const meta = getBlockMeta(block.kind);
  if (meta?.fields.some((field) => field.key === "label")) {
    const label = props.label;
    if (typeof label !== "string" || label.trim().length === 0) {
      add({
        code: ISSUE_CODES.emptyLabel,
        message: `This ${meta.label.toLowerCase()} question has no label.`,
        blockId: block.id,
        path: `${path}.props.label`,
        level: "error",
      });
    }
  }

  // NO_OPTIONS / DUP_OPTION — client-side supplement (§8.1): "select blocks
  // need ≥ 2 non-empty, unique options". The schema only enforces ≥ 1
  // non-empty labels (OptionList), not the count/uniqueness rules.
  if (SELECT_KINDS.has(block.kind) && Array.isArray(props.options)) {
    const labels = props.options
      .map((option) => (typeof (option as { label?: unknown })?.label === "string" ? ((option as { label: string }).label).trim() : ""))
      .filter((label) => label.length > 0);
    if (labels.length < 2) {
      add({
        code: ISSUE_CODES.noOptions,
        message: "Select questions need at least 2 non-empty options.",
        blockId: block.id,
        path: `${path}.props.options`,
        level: "error",
      });
    }
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const label of labels) {
      if (seen.has(label)) duplicates.add(label);
      seen.add(label);
    }
    if (duplicates.size > 0) {
      add({
        code: ISSUE_CODES.dupOption,
        message: `Duplicate option label${duplicates.size > 1 ? "s" : ""}: ${[...duplicates].map((l) => `“${l}”`).join(", ")}.`,
        blockId: block.id,
        path: `${path}.props.options`,
        level: "error",
      });
    }
  }

  // BAD_RANGE — client-side supplement (§8.1): min > max, scale out of 3–10,
  // maxLength < 1. The schema already rejects most of these; the check keeps
  // the §8.1 code stable for drafts captured mid-edit.
  if (block.kind === "number") {
    const min = props.min;
    const max = props.max;
    if (typeof min === "number" && typeof max === "number" && min > max) {
      add({
        code: ISSUE_CODES.badRange,
        message: "Minimum cannot be greater than maximum.",
        blockId: block.id,
        path: `${path}.props.max`,
        level: "error",
      });
    }
  }
  if (block.kind === "rating") {
    const scale = props.scale;
    if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 3 || scale > 10) {
      add({
        code: ISSUE_CODES.badRange,
        message: "Rating scale must be between 3 and 10.",
        blockId: block.id,
        path: `${path}.props.scale`,
        level: "error",
      });
    }
  }
  if (block.kind === "short-text" || block.kind === "long-text") {
    const maxLength = props.maxLength;
    if (maxLength !== undefined && (typeof maxLength !== "number" || maxLength < 1)) {
      add({
        code: ISSUE_CODES.badRange,
        message: "Max length must be at least 1.",
        blockId: block.id,
        path: `${path}.props.maxLength`,
        level: "error",
      });
    }
  }

  // FILE_TOO_LARGE — client-side supplement (§8.1): maxSizeMb over the plan
  // limit (10 MB default).
  if (block.kind === "file-upload") {
    const maxSizeMb = props.maxSizeMb;
    if (typeof maxSizeMb === "number" && maxSizeMb > FILE_UPLOAD_PLAN_LIMIT_MB) {
      add({
        code: ISSUE_CODES.fileTooLarge,
        message: `Max file size cannot exceed the plan limit of ${FILE_UPLOAD_PLAN_LIMIT_MB} MB.`,
        blockId: block.id,
        path: `${path}.props.maxSizeMb`,
        level: "error",
      });
    }
  }

  // BAD_URL — client-side supplement (§8.1): button hrefs must parse and must
  // not use script schemes (safeHref blocks javascript:/data:/vbscript: at
  // render time; publishing should not ship them at all).
  if (block.kind === "button" && typeof props.href === "string") {
    if (!isSafeUrl(props.href)) {
      add({
        code: ISSUE_CODES.badUrl,
        message: "This button link is not a valid URL.",
        blockId: block.id,
        path: `${path}.props.href`,
        level: "error",
      });
    }
  }
}

// --- document-level checks ---------------------------------------------------

function collectDocumentIssues(body: DocumentBody, add: (issue: ValidationIssue) => void): void {
  // NO_QUESTIONS — client-side supplement (§8.1): a form with zero question
  // blocks. Pages/portfolios are content documents and don't need questions.
  if (body.type === "form") {
    let questions = 0;
    walkBlocks(body.blocks, "blocks", (block) => {
      if (getBlockMeta(block.kind)?.family === "question") questions += 1;
    });
    if (questions === 0) {
      add({
        code: ISSUE_CODES.noQuestions,
        message: "Add at least one question before publishing.",
        blockId: null,
        path: "blocks",
        level: "error",
      });
    }

    // NO_ENDING — client-side supplement (§8.1): the form has no ending.
    if ((body.endings ?? []).length === 0) {
      add({
        code: ISSUE_CODES.noEnding,
        message: "Add an ending (thank-you screen) before publishing.",
        blockId: null,
        path: "endings",
        level: "error",
      });
    }
  }

  // Ending redirect URLs — BAD_URL client-side supplement (§8.1/§8.3):
  // must be an absolute http(s) URL. The schema enforces URL *syntax*; this
  // also rejects non-http schemes (e.g. javascript:).
  (body.endings ?? []).forEach((ending, index) => {
    if (typeof ending.redirectUrl === "string" && !isAbsoluteHttpUrl(ending.redirectUrl)) {
      add({
        code: ISSUE_CODES.badUrl,
        message: "The ending redirect must be a valid https:// URL.",
        blockId: null,
        path: `endings[${index}].redirectUrl`,
        level: "error",
      });
    }
  });

  // BAD_EMAIL — client-side supplement (§8.1): notification emails in
  // settings fields must be valid addresses (schema also enforces this; this
  // keeps the §8.1 code for drafts mid-edit).
  (body.settings?.notifyEmails ?? []).forEach((email, index) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      add({
        code: ISSUE_CODES.badEmail,
        message: `“${email}” is not a valid notification email address.`,
        blockId: null,
        path: `settings.notifyEmails[${index}]`,
        level: "error",
      });
    }
  });
}

/** Parseable URL with no script scheme (relative URLs allowed). */
function isSafeUrl(href: string): boolean {
  if (safeHref(href) === "#" && href.trim() !== "#") return false;
  try {
    // Relative URLs resolve against any base; only unparseable strings throw.
    void new URL(href, "https://formforge.invalid");
    return true;
  } catch {
    return false;
  }
}

/** Absolute http(s) URL (endings' redirectUrl per §8.3 "validated https"). */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// groupIssues (§8.1 document level: "Issues list grouped by block")
// ---------------------------------------------------------------------------

export type IssueGroup = {
  /** `null` group = document-level issues ("Document"). */
  blockId: string | null;
  label: string;
  issues: ValidationIssue[];
};

/**
 * Group issues for the IssuesList drawer. The document-level group (blockId
 * null) comes first; block groups follow in first-appearance order.
 * `labelFor` maps a block id to its display label (builder passes
 * blockDisplayLabel over the current body); fallback "Block <id>".
 */
export function groupIssues(
  issues: readonly ValidationIssue[],
  labelFor?: (blockId: string) => string | undefined,
): IssueGroup[] {
  const groups: IssueGroup[] = [];
  const byBlock = new Map<string, IssueGroup>();

  const docIssues = issues.filter((issue) => issue.blockId === null);
  if (docIssues.length > 0) {
    groups.push({ blockId: null, label: "Document", issues: [...docIssues] });
  }
  for (const issue of issues) {
    if (issue.blockId === null) continue;
    let group = byBlock.get(issue.blockId);
    if (group === undefined) {
      group = {
        blockId: issue.blockId,
        label: labelFor?.(issue.blockId) ?? `Block ${issue.blockId}`,
        issues: [],
      };
      byBlock.set(issue.blockId, group);
      groups.push(group);
    }
    group.issues.push(issue);
  }
  return groups;
}

/**
 * Merge two issue lists (local + server 422 list), dropping exact duplicates
 * (`code|blockId|path|message`). Server issues come last so a local issue the
 * server agrees with keeps the friendlier local message.
 */
export function mergeIssues(
  local: readonly ValidationIssue[],
  server: readonly ValidationIssue[],
): ValidationIssue[] {
  const out = [...local];
  const seen = new Set(out.map(issueKey));
  for (const issue of server) {
    const key = issueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function issueKey(issue: ValidationIssue): string {
  return `${issue.code}|${issue.blockId ?? ""}|${issue.path ?? ""}|${issue.message}`;
}

// ---------------------------------------------------------------------------
// Publish button state machine (§4 Publish button states)
// ---------------------------------------------------------------------------

export type PublishButtonState = "publish" | "published" | "publishing" | "fix-issues";

export type PublishButtonInput = {
  docStatus: "draft" | "published";
  save: SaveStatusLike;
  issues: readonly ValidationIssue[];
  publishing: boolean;
};

/**
 * §4: `Publish` (unpublished or changes pending) / `Published ✓` (disabled,
 * "Live — view" link) / `Publishing…` / `Fix N issues` (opens the list).
 * - publishing wins (in-flight);
 * - blocking issues → fix-issues (warnings do NOT block, §8.1);
 * - published AND no pending changes → published ✓;
 * - published but draft differs (§7.5) → back to Publish (re-publish);
 * - otherwise → Publish.
 */
export function publishButtonState(input: PublishButtonInput): PublishButtonState {
  if (input.publishing) return "publishing";
  if (blockingCount(input.issues) > 0) return "fix-issues";
  if (input.docStatus === "published" && !UNPUBLISHED_SAVE_STATES.has(input.save)) {
    return "published";
  }
  return "publish";
}

/**
 * §7.5: show the amber "Unpublished changes" chip when the draft differs from
 * the published version — pending save states — or when validation issues
 * exist at all.
 */
export function hasUnpublishedChanges(
  save: SaveStatusLike,
  issues: readonly ValidationIssue[],
): boolean {
  return UNPUBLISHED_SAVE_STATES.has(save) || issues.length > 0;
}

// ---------------------------------------------------------------------------
// POST /api/v1/documents/:id/publish (spec §22.1)
// ---------------------------------------------------------------------------

export type PublishResult =
  | {
      ok: true;
      /** Public URL of the live form (server `url`; §22.1 / actual `PublishOutcome`). */
      url?: string;
      /** Server `publishedRev` (§22.1) or the version ordinal the current API returns. */
      publishedRev?: number;
      publishedAt?: string;
    }
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "validation"; issues: ValidationIssue[] }
  | { ok: false; reason: "error"; message: string };

/** Minimal fetch seam so tests stub responses without a network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

type UnknownRecord = Record<string, unknown>;

/**
 * Thin POST wrapper per §22.1: `{ expectedRev }` in, `{ publishedRev,
 * publishedAt, url }` out; `409` → conflict (caller flushes pending ops via
 * the `ff:force-save` window event and asks the user to retry); `422` →
 * server issues (both the §22.1 `{ issues }` shape and the §4 error envelope
 * `{ error: { details: [...] } }` the current API answers with are parsed).
 * Headers mirror lib/builder/transport.ts conventions.
 */
export async function publishDocument(
  docId: string,
  expectedRev: number,
  fetchImpl: FetchLike = defaultFetch,
): Promise<PublishResult> {
  let res: Pick<Response, "ok" | "status" | "json">;
  try {
    res = await fetchImpl(`/api/v1/documents/${encodeURIComponent(docId)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ expectedRev }),
    });
  } catch {
    return { ok: false, reason: "error", message: "Network error — check your connection and try again." };
  }

  if (res.ok) {
    const json = (await readJson(res)) as UnknownRecord | null;
    return {
      ok: true,
      url: typeof json?.url === "string" ? json.url : undefined,
      publishedRev:
        typeof json?.publishedRev === "number"
          ? json.publishedRev
          : typeof json?.version === "number"
            ? json.version
            : undefined,
      publishedAt: typeof json?.publishedAt === "string" ? json.publishedAt : undefined,
    };
  }

  if (res.status === 409) return { ok: false, reason: "conflict" };

  const json = (await readJson(res)) as UnknownRecord | null;
  if (res.status === 422) {
    const errorRecord = (json?.error ?? undefined) as UnknownRecord | undefined;
    const raw = Array.isArray(json?.issues)
      ? (json.issues as unknown[])
      : Array.isArray(errorRecord?.details)
        ? (errorRecord.details as unknown[])
        : [];
    return {
      ok: false,
      reason: "validation",
      issues: raw.map(wireIssueToValidationIssue),
    };
  }

  const errorRecord = (json?.error ?? undefined) as UnknownRecord | undefined;
  const message =
    typeof errorRecord?.message === "string"
      ? errorRecord.message
      : `Publish failed with status ${res.status}.`;
  return { ok: false, reason: "error", message };
}

async function readJson(res: Pick<Response, "json">): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function wireIssueToValidationIssue(raw: unknown): ValidationIssue {
  const record = (raw ?? {}) as UnknownRecord;
  const path = typeof record.path === "string" ? record.path : undefined;
  return {
    code: typeof record.code === "string" ? record.code : ISSUE_CODES.server,
    message: typeof record.message === "string" ? record.message : "Invalid document.",
    blockId: typeof record.blockId === "string" ? record.blockId : null,
    ...(path !== undefined ? { path } : {}),
    level: record.level === "warning" ? "warning" : "error",
  };
}
