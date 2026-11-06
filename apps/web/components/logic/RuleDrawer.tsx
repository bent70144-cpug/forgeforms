"use client";

// Rule drawer (spec §14.1.4): add/edit rules for a scope — IF conditions with
// AND, THEN goto/set, "in all other cases" fallback toggle, per-question
// prefill URL param, and the hidden-fields (UTM) config on the start node.
//
// Every mutation applies immediately through the ops channel (rule.upsert /
// rule.remove / block.update / settings.update) and autosaves.

import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentBody, Rule } from "@/lib/bridge";
import type { Op } from "@/lib/builder/ops";
import {
  CONDITION_OPS,
  OP_LABELS,
  fallbackTaken,
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

export function RuleDrawer({ scope, body, targets, onApply, onClose }: RuleDrawerProps) {
  const isEnding = scope.kind === "ending";
  const { rules, fallback } = useMemo(
    () => rulesForScope(body.logic?.rules ?? [], scope.id),
    [body.logic?.rules, scope.id],
  );

  return (
    <aside
      className="absolute right-0 top-0 z-20 flex h-full w-[400px] max-w-[90vw] flex-col border-l border-slate-200 bg-white shadow-xl"
      data-testid="rule-drawer"
      aria-label={`Rules for ${scope.label}`}
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {scope.kind === "start" ? "Start" : scope.kind === "ending" ? "Ending" : scope.questionKind ?? "Question"}
          </div>
          <h2 className="text-sm font-semibold text-slate-800">{scope.label}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          aria-label="Close rules drawer"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isEnding && (
          <p className="text-sm text-slate-500">
            Endings are targets of <code className="rounded bg-slate-100 px-1">goto</code> actions.
            Configure them on the question nodes (or Start) with rules.
          </p>
        )}

        {!isEnding && (
          <>
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

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                onClick={() => onApply([upsertRuleOp(newRuleDraft(scope.id))])}
              >
                + Add rule
              </button>
              {fallback === null && (
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  onClick={() => {
                    const draft = newRuleDraft(scope.id);
                    onApply([upsertRuleOp({ ...draft, isFallback: true, conditions: [], actions: [emptyGotoDraft()] })]);
                  }}
                >
                  + In all other cases
                </button>
              )}
            </div>

            {scope.kind === "question" && <PrefillSection scope={scope} body={body} onApply={onApply} />}
            {scope.kind === "start" && <HiddenFieldsSection body={body} onApply={onApply} />}
          </>
        )}
      </div>
    </aside>
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
    <section
      className="mb-4 rounded-xl border border-slate-200 p-3"
      data-testid={`rule-${rule.id}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500">
          {draft.isFallback ? "In all other cases" : "IF (all match — AND)"}
        </span>
        <button
          type="button"
          className="text-xs text-red-500 hover:underline"
          onClick={() => onApply([removeRuleOp(rule.id)])}
          aria-label={`Delete rule ${rule.id}`}
        >
          Delete
        </button>
      </div>

      {!draft.isFallback &&
        draft.conditions.map((condition) => (
          <div key={condition.key} className="mb-2 flex flex-wrap items-center gap-1.5">
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
              value={condition.source}
              aria-label="Condition source"
              onChange={(e) =>
                updateCondition(condition.key, { source: e.target.value as ConditionDraft["source"] })
              }
            >
              <option value="block">@block</option>
              <option value="var">@var</option>
              <option value="hidden">@hidden</option>
            </select>
            <input
              className="w-28 rounded-md border border-slate-200 px-2 py-1 text-xs"
              value={condition.ref}
              placeholder={condition.source === "block" ? "block id" : "name"}
              aria-label="Condition reference"
              list={condition.source === "block" ? "ff-block-ids" : undefined}
              onChange={(e) => updateCondition(condition.key, { ref: e.target.value })}
            />
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
              value={condition.op}
              aria-label="Operator"
              onChange={(e) => updateCondition(condition.key, { op: e.target.value as ConditionDraft["op"] })}
            >
              {CONDITION_OPS.map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {condition.op !== "isEmpty" && (
              <input
                className="w-24 rounded-md border border-slate-200 px-2 py-1 text-xs"
                value={condition.right}
                placeholder="value"
                aria-label="Compare value"
                onChange={(e) => updateCondition(condition.key, { right: e.target.value })}
              />
            )}
            <button
              type="button"
              className="text-xs text-slate-400 hover:text-red-500"
              aria-label="Remove condition"
              onClick={() =>
                persist({
                  ...draft,
                  conditions: draft.conditions.filter((c) => c.key !== condition.key),
                })
              }
            >
              ✕
            </button>
          </div>
        ))}

      {!draft.isFallback && (
        <button
          type="button"
          className="mb-2 text-[11px] font-medium text-indigo-600 hover:underline"
          onClick={() => persist({ ...draft, conditions: [...draft.conditions, emptyConditionDraft()] })}
        >
          + AND condition
        </button>
      )}

      <div className="mt-1 border-t border-slate-100 pt-2">
        <div className="mb-1 text-xs font-semibold text-slate-500">THEN</div>
        {draft.actions.map((action) => (
          <div key={action.key} className="mb-2 flex flex-wrap items-center gap-1.5">
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
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
            </select>
            {action.kind === "goto" ? (
              <select
                className="max-w-[180px] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
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
              </select>
            ) : (
              <>
                <input
                  className="w-24 rounded-md border border-slate-200 px-2 py-1 text-xs"
                  value={action.var}
                  placeholder="variable"
                  aria-label="Variable name"
                  onChange={(e) => updateAction(action.key, { var: e.target.value })}
                />
                <input
                  className="w-24 rounded-md border border-slate-200 px-2 py-1 text-xs"
                  value={action.value}
                  placeholder="value"
                  aria-label="Variable value"
                  onChange={(e) => updateAction(action.key, { value: e.target.value })}
                />
              </>
            )}
            <button
              type="button"
              className="text-xs text-slate-400 hover:text-red-500"
              aria-label="Remove action"
              onClick={() => persist({ ...draft, actions: draft.actions.filter((a) => a.key !== action.key) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-[11px] font-medium text-indigo-600 hover:underline"
          onClick={() => persist({ ...draft, actions: [...draft.actions, emptyGotoDraft()] })}
        >
          + action
        </button>
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
    <section className="mt-4 rounded-xl border border-slate-200 p-3">
      <div className="text-xs font-semibold text-slate-500">Prefill via URL param</div>
      <p className="mt-1 text-[11px] text-slate-400">
        Answers this question from a URL parameter (e.g. <code>?email=…</code>).
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          className="w-40 rounded-md border border-slate-200 px-2 py-1 text-xs"
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
          <span className="text-[11px] text-amber-600">unsaved — blur or tab away to apply</span>
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
    <section className="mt-4 rounded-xl border border-slate-200 p-3" data-testid="hidden-fields">
      <div className="text-xs font-semibold text-slate-500">Hidden fields (UTM capture)</div>
      <p className="mt-1 text-[11px] text-slate-400">
        Captured from the public URL on start (spec §10.3) and stored with every submission — visible
        in the results drawer. Use <code className="rounded bg-slate-100 px-1">@hidden:&lt;name&gt;</code> in conditions.
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {DEFAULT_HIDDEN_FIELDS.map((field) => (
          <li key={field} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            {field}
          </li>
        ))}
        {extras.map((extra) => (
          <li key={extra.name} className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
            {extra.name}
            <button
              type="button"
              aria-label={`Remove hidden field ${extra.name}`}
              className="text-indigo-400 hover:text-red-500"
              onClick={() => saveExtras(extras.filter((e) => e.name !== extra.name))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          className="w-40 rounded-md border border-slate-200 px-2 py-1 text-xs"
          value={name}
          placeholder="extra param (e.g. referrer)"
          aria-label="Extra hidden field name"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
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
