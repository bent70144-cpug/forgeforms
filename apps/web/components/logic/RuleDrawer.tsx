"use client";

// Rule drawer (spec §14.1.4): add/edit rules for a scope — IF conditions with
// AND, THEN goto/set, "in all other cases" fallback toggle, per-question
// prefill URL param, and the hidden-fields (UTM) config on the start node.
//
// Every mutation applies immediately through the ops channel (rule.upsert /
// rule.remove / block.update / settings.update) and autosaves.
//
// Redesign (B7): the old absolutely-positioned <aside> is replaced by the
// shared Drawer primitive (overlay + slide + Esc + focus trap + scroll lock,
// 26rem wide, 92vw on mobile). Rule-editing state/handlers are unchanged; only
// control presentation moved to compact shared widgets (chevron selects, icon
// remove buttons, ≥12px helper copy).

import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import type { DocumentBody, Rule } from "@/lib/bridge";
import type { Op } from "@/lib/builder/ops";
import { BADGE_MUTED, BTN_SECONDARY_SM, ICON_BTN } from "@/lib/ui";
import { Drawer } from "@/components/ui/drawer";
import { Icon, type IconName } from "@/components/ui/icons";
import {
  CONDITION_OPS,
  OP_LABELS,
  draftFromRule,
  emptyConditionDraft,
  emptyGotoDraft,
  newRuleDraft,
  removeRuleOp,
  ruleFromDraft,
  rulesForScope,
  upsertRuleOp,
  type ActionDraft,
  type ConditionDraft,
  type RuleDraft,
} from "@/lib/logic/rules";
import { DEFAULT_HIDDEN_FIELDS } from "@/lib/logic/hidden";

export type ScopeInfo = {
  /** Canvas node id: "start", a blockId, or "end:<endingId>". */
  id: string;
  kind: "start" | "question" | "ending";
  label: string;
  questionKind?: string;
};

export type RuleDrawerProps = {
  scope: ScopeInfo;
  body: DocumentBody;
  /** All goto-target options (question blocks + endings). */
  targets: Array<{ id: string; label: string }>;
  onApply: (ops: readonly Op[]) => void;
  onClose: () => void;
};

/* ---------------------------------------------------------------------------
 * Compact control kit (drawer-local)
 * ------------------------------------------------------------------------- */

// .ff-input defaults are authored unlayered (wins over layered utilities), so
// compaction overrides need the trailing `!` important modifier.
const CTRL = "ff-input min-h-[2.25rem]! rounded-lg! px-2.5! text-[13px]!";

/** Compact select with a consistent chevron overlay (native arrows differ per browser). */
function SelectControl({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex">
      <select
        {...rest}
        className={`${CTRL} w-auto! appearance-none pr-7! ${className ?? ""}`}
      />
      <Icon
        name="chevronDown"
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ff-muted)]"
      />
    </span>
  );
}

/** Compact text input (explicit width via className; .ff-input is w-full). */
function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${CTRL} ${className ?? ""}`} />;
}

/** Quiet icon remove action — muted until hover, then danger. */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${ICON_BTN} h-8! w-8! shrink-0 hover:text-[var(--ff-danger)]! max-lg:h-10! max-lg:w-10!`}
      aria-label={label}
      onClick={onClick}
    >
      <Icon name="x" size={14} />
    </button>
  );
}

/** Ghost-tinted add action (accent 6% over card, accent 20% hairline). */
const BTN_TINTED_SM =
  "ff-btn ff-btn-sm border-[color-mix(in_srgb,var(--ff-accent)_20%,transparent)]! bg-[color-mix(in_srgb,var(--ff-accent)_6%,var(--ff-card))]! text-[var(--ff-fg)]! hover:-translate-y-px hover:shadow-[var(--ff-shadow-sm)]";

/** Inline "+ …" text action for adding conditions/actions inside a rule card. */
function AddInlineButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded text-xs font-medium text-[var(--ff-primary)] transition-colors hover:text-[var(--ff-fg)] hover:underline"
      onClick={onClick}
    >
      <Icon name="plus" size={12} />
      {label}
    </button>
  );
}

/** Drawer section heading: icon + label + optional count badge. */
function SectionHeader({ icon, title, count }: { icon: IconName; title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ff-fg)]">
        <Icon name={icon} size={14} className="text-[var(--ff-muted)]" />
        {title}
      </h3>
      {count !== undefined && <span className={BADGE_MUTED}>{count}</span>}
    </div>
  );
}

/** Shared card surface for rule cards + config sections inside the drawer. */
const CARD_SOFT =
  "rounded-xl border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_2%,var(--ff-bg))] p-3";

/* --------------------------------------------------------------------------- */

export function RuleDrawer({ scope, body, targets, onApply, onClose }: RuleDrawerProps) {
  const isEnding = scope.kind === "ending";
  const { rules, fallback } = useMemo(
    () => rulesForScope(body.logic?.rules ?? [], scope.id),
    [body.logic?.rules, scope.id],
  );

  return (
    <Drawer open onClose={onClose} title="Rules" description={scope.label} width="26rem">
      <div className="flex flex-col gap-4 pb-2" data-testid="rule-drawer" aria-label={`Rules for ${scope.label}`}>
        {/* Keyboard-first close (first tab stop inside the panel; complements the
            header's ✕ and Esc). Named to match the builder e2e + T28 sweep. */}
        <button
          type="button"
          className="sr-only focus:not-sr-only focus:rounded-md focus:px-2 focus:py-1 focus:text-xs focus:font-medium focus:text-[var(--ff-primary)] focus:underline"
          aria-label="Close rules drawer"
          onClick={onClose}
        >
          Close rules drawer
        </button>
        {isEnding && (
          <p className="text-xs leading-relaxed text-[var(--ff-muted)]">
            Endings are targets of{" "}
            <code className="rounded bg-[color-mix(in_srgb,var(--ff-fg)_8%,transparent)] px-1 font-mono">
              goto
            </code>{" "}
            actions. Configure them on the question nodes (or Start) with rules.
          </p>
        )}

        {!isEnding && (
          <>
            <div className="flex flex-col gap-2.5" aria-label="Rules">
              <SectionHeader icon="flow" title="Rules" count={rules.length + (fallback ? 1 : 0)} />
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  scope={scope}
                  targets={targets}
                  body={body}
                  onApply={onApply}
                />
              ))}
              {fallback && (
                <RuleCard
                  rule={fallback}
                  scope={scope}
                  targets={targets}
                  body={body}
                  onApply={onApply}
                />
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${BTN_TINTED_SM} inline-flex items-center gap-1.5`}
                  aria-label="+ Add rule"
                  onClick={() => onApply([upsertRuleOp(newRuleDraft(scope.id))])}
                >
                  <Icon name="plus" size={14} />
                  Add rule
                </button>
                {fallback === null && (
                  <button
                    type="button"
                    className={`${BTN_TINTED_SM} inline-flex items-center gap-1.5`}
                    aria-label="+ In all other cases"
                    onClick={() => {
                      const draft = newRuleDraft(scope.id);
                      onApply([upsertRuleOp({ ...draft, isFallback: true, conditions: [], actions: [emptyGotoDraft()] })]);
                    }}
                  >
                    <Icon name="plus" size={14} />
                    In all other cases
                  </button>
                )}
              </div>
            </div>

            {scope.kind === "question" && <PrefillSection scope={scope} body={body} onApply={onApply} />}
            {scope.kind === "start" && <HiddenFieldsSection body={body} onApply={onApply} />}
          </>
        )}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// One rule card (conditions AND-ed, then actions, fallback badge)
// ---------------------------------------------------------------------------

function RuleCard({
  rule,
  scope,
  targets,
  body,
  onApply,
}: {
  rule: Rule;
  scope: ScopeInfo;
  targets: Array<{ id: string; label: string }>;
  body: DocumentBody;
  onApply: (ops: readonly Op[]) => void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(() => draftFromRule(rule));
  // JSON of the rule as last persisted by THIS card — lets the effect below
  // distinguish our own optimistic echo from external/409-recovery edits.
  const lastPersisted = useRef<string>("");

  // Re-sync when the server/another edit changes this rule externally (e.g.
  // 409 reconciliation), without clobbering in-flight local edits.
  useEffect(() => {
    const json = JSON.stringify(rule);
    if (json !== lastPersisted.current) setDraft(draftFromRule(rule));
    lastPersisted.current = json;
  }, [rule]);

  const persist = (next: RuleDraft): void => {
    const persisted = ruleFromDraft(next);
    setDraft(next);
    lastPersisted.current = JSON.stringify(persisted);
    onApply([upsertRuleOp(next)]);
  };

  const blocks = body.blocks ?? [];
  const blockOptions = blocks
    .filter((b) => typeof b.id === "string" && b.id !== scope.id)
    .map((b) => ({ id: b.id, label: (typeof b.props["label"] === "string" ? b.props["label"] : b.id) as string }));

  const updateCondition = (key: string, patch: Partial<ConditionDraft>): void => {
    persist({
      ...draft,
      conditions: draft.conditions.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    });
  };

  const updateAction = (key: string, patch: Partial<ActionDraft>): void => {
    persist({
      ...draft,
      actions: draft.actions.map((a) => (a.key === key ? ({ ...a, ...patch } as ActionDraft) : a)),
    });
  };

  return (
    <section className={CARD_SOFT} data-testid={`rule-${rule.id}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--ff-muted)]">
          {draft.isFallback ? "In all other cases" : "IF (all match — AND)"}
        </span>
        <RemoveButton label="Remove rule" onClick={() => onApply([removeRuleOp(rule.id)])} />
      </div>

      {!draft.isFallback && (
        <div className="space-y-2">
          {draft.conditions.map((condition) => (
            <div key={condition.key} className="flex flex-wrap items-center gap-2">
              <SelectControl
                value={condition.source}
                aria-label="Condition source"
                onChange={(e) =>
                  updateCondition(condition.key, { source: e.target.value as ConditionDraft["source"] })
                }
              >
                <option value="block">@block</option>
                <option value="var">@var</option>
                <option value="hidden">@hidden</option>
              </SelectControl>
              <TextInput
                className="w-28!"
                value={condition.ref}
                placeholder={condition.source === "block" ? "block id" : "name"}
                aria-label="Condition reference"
                list={condition.source === "block" ? "ff-block-ids" : undefined}
                onChange={(e) => updateCondition(condition.key, { ref: e.target.value })}
              />
              <SelectControl
                value={condition.op}
                aria-label="Operator"
                onChange={(e) => updateCondition(condition.key, { op: e.target.value as ConditionDraft["op"] })}
              >
                {CONDITION_OPS.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABELS[op]}
                  </option>
                ))}
              </SelectControl>
              {condition.op !== "isEmpty" && (
                <TextInput
                  className="w-24!"
                  value={condition.right}
                  placeholder="value"
                  aria-label="Compare value"
                  onChange={(e) => updateCondition(condition.key, { right: e.target.value })}
                />
              )}
              <RemoveButton
                label="Remove condition"
                onClick={() =>
                  persist({
                    ...draft,
                    conditions: draft.conditions.filter((c) => c.key !== condition.key),
                  })
                }
              />
            </div>
          ))}
          <AddInlineButton
            label="AND condition"
            onClick={() => persist({ ...draft, conditions: [...draft.conditions, emptyConditionDraft()] })}
          />
        </div>
      )}

      <div className={`${draft.isFallback ? "" : "mt-2 border-t border-[var(--ff-border)] pt-2"}`}>
        <div className="mb-1.5 text-xs font-semibold tracking-normal text-[var(--ff-muted)]">THEN</div>
        <div className="space-y-2">
          {draft.actions.map((action) => (
            <div key={action.key} className="flex flex-wrap items-center gap-2">
              <SelectControl
                value={action.kind}
                aria-label="Action type"
                onChange={(e) => {
                  const kind = e.target.value as ActionDraft["kind"];
                  updateAction(
                    action.key,
                    kind === "goto"
                      ? { kind, target: action.kind === "goto" ? action.target : "" }
                      : { kind, var: action.kind === "set" ? action.var : "", value: action.kind === "set" ? action.value : "" },
                  );
                }}
              >
                <option value="goto">goto</option>
                <option value="set">set variable</option>
              </SelectControl>
              {action.kind === "goto" ? (
                <SelectControl
                  className="max-w-[200px]"
                  value={action.target}
                  aria-label="Goto target"
                  onChange={(e) => updateAction(action.key, { target: e.target.value })}
                >
                  <option value="">— choose target —</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </SelectControl>
              ) : (
                <>
                  <TextInput
                    className="w-24!"
                    value={action.var}
                    placeholder="variable"
                    aria-label="Variable name"
                    onChange={(e) => updateAction(action.key, { var: e.target.value })}
                  />
                  <TextInput
                    className="w-24!"
                    value={action.value}
                    placeholder="value"
                    aria-label="Variable value"
                    onChange={(e) => updateAction(action.key, { value: e.target.value })}
                  />
                </>
              )}
              <RemoveButton
                label="Remove action"
                onClick={() => persist({ ...draft, actions: draft.actions.filter((a) => a.key !== action.key) })}
              />
            </div>
          ))}
          <AddInlineButton
            label="action"
            onClick={() => persist({ ...draft, actions: [...draft.actions, emptyGotoDraft()] })}
          />
        </div>
      </div>

      <datalist id="ff-block-ids">
        {blockOptions.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </datalist>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-question prefill (spec §7.2 prefillParam) — question nodes only
// ---------------------------------------------------------------------------

function PrefillSection({
  scope,
  body,
  onApply,
}: {
  scope: ScopeInfo;
  body: DocumentBody;
  onApply: (ops: readonly Op[]) => void;
}) {
  const block = (body.blocks ?? []).find((b) => b.id === scope.id);
  const current = block && typeof block.props["prefillParam"] === "string" ? (block.props["prefillParam"] as string) : "";
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);

  return (
    <section className={`${CARD_SOFT} flex flex-col gap-2`} aria-label="Prefill">
      <SectionHeader icon="link" title="Prefill" />
      <p className="text-xs leading-relaxed text-[var(--ff-muted)]">
        Answers this question from a URL parameter (e.g.{" "}
        <code className="rounded bg-[color-mix(in_srgb,var(--ff-fg)_8%,transparent)] px-1 font-mono">?email=…</code>
        ).
      </p>
      <div className="flex flex-col gap-1.5">
        <TextInput
          className="w-full"
          value={value}
          placeholder="param name"
          aria-label="Prefill URL parameter"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (value !== current) {
              onApply([{ op: "block.update", id: scope.id, props: { prefillParam: value || null } }]);
            }
          }}
        />
        {value !== current && (
          <span className="text-xs text-[var(--ff-warning)]">unsaved — blur or tab away to apply</span>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hidden fields (UTM capture) — start node only
// ---------------------------------------------------------------------------

function HiddenFieldsSection({
  body,
  onApply,
}: {
  body: DocumentBody;
  onApply: (ops: readonly Op[]) => void;
}) {
  const extras = body.settings.hiddenFields ?? [];
  const [name, setName] = useState("");

  const saveExtras = (next: Array<{ name: string; label?: string }>): void => {
    onApply([{ op: "settings.update", patch: { hiddenFields: next } }]);
  };

  return (
    <section className={`${CARD_SOFT} flex flex-col gap-2`} data-testid="hidden-fields" aria-label="Hidden fields">
      <SectionHeader icon="eyeOff" title="Hidden fields" count={DEFAULT_HIDDEN_FIELDS.length + extras.length} />
      <p className="text-xs leading-relaxed text-[var(--ff-muted)]">
        Captured from the public URL on start (spec §10.3) and stored with every submission — visible
        in the results drawer. Use{" "}
        <code className="rounded bg-[color-mix(in_srgb,var(--ff-fg)_8%,transparent)] px-1 font-mono">
          @hidden:&lt;name&gt;
        </code>{" "}
        in conditions.
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {DEFAULT_HIDDEN_FIELDS.map((field) => (
          <li
            key={field}
            className="rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)] px-2 py-0.5 text-xs text-[var(--ff-muted)]"
          >
            {field}
          </li>
        ))}
        {extras.map((extra) => (
          <li
            key={extra.name}
            className="flex items-center gap-0.5 rounded-full border border-[color-mix(in_srgb,var(--ff-accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--ff-accent)_10%,transparent)] px-2 py-0.5 text-xs text-[var(--ff-fg)]"
          >
            {extra.name}
            <button
              type="button"
              aria-label={`Remove hidden field ${extra.name}`}
              className="rounded-full p-0.5 text-[var(--ff-muted)] transition-colors hover:text-[var(--ff-danger)]"
              onClick={() => saveExtras(extras.filter((e) => e.name !== extra.name))}
            >
              <Icon name="x" size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <TextInput
          className="w-44!"
          value={name}
          placeholder="extra param (e.g. referrer)"
          aria-label="Extra hidden field name"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className={`${BTN_SECONDARY_SM} inline-flex items-center gap-1`}
          onClick={() => {
            const trimmed = name.trim();
            if (trimmed === "") return;
            if (extras.some((e) => e.name === trimmed)) return;
            saveExtras([...extras, { name: trimmed }]);
            setName("");
          }}
        >
          Add
        </button>
      </div>
    </section>
  );
}
