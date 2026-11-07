'use client';

// Block settings (builder spec §6.6 "Block selected" + §9): the block's
// registry Editor in the Content section, generic question fields under
// Behavior (fields that exist on QuestionPropsBase only), a Logic summary,
// and Advanced (read-only id + copy, reset to defaults).
//
// Autosave rules (§6.6, §13): toggles dispatch immediately; text inputs
// dispatch debounced 300 ms; errors style the field, never block autosave.
//
// Coalescing convention (§3.3, same as Canvas typing): every `block.update`
// this panel sends uses key `update:<blockId>` so rapid panel edits merge with
// canvas inline-typing edits into one history entry + one outgoing op.

import { useState } from "react";
import type { Block } from "@formforge/schema";
import { FILE_UPLOAD_BLOCK_MAX_MB, getBlockDef } from "@formforge/blocks";
import { findBlock } from "@/lib/builder/ops";
import { useBuilder } from "../context";
import { SettingsSection, FieldRow, InlineNote, FF_SET_INPUT_CLASS } from "./FieldRow";
import { ToggleRow } from "./ToggleRow";
import {
  copyTextToClipboard,
  isValidPrefillParam,
  prefillParamConflict,
  sensitiveLabelWarning,
  useDebouncedPatch,
  useDraftSync,
} from "./settings-helpers";

export function BlockSettings() {
  const { state, dispatch } = useBuilder();
  const found = state.selection ? findBlock(state.body.blocks, state.selection) : null;

  if (!found) {
    return (
      <div className="ff-set-panel p-3" data-testid="block-settings-empty">
        <InlineNote>Nothing is selected — pick a block on the canvas.</InlineNote>
      </div>
    );
  }

  const { block } = found;
  const def = getBlockDef(block.kind);

  if (!def) {
    // Unknown kind (forward compatibility, §5.4): settings are read-only.
    return (
      <div className="ff-set-panel p-3" data-testid="block-settings-unknown">
        <InlineNote tone="warn">This block type isn&apos;t supported in this version</InlineNote>
        <FieldRow label="Block id" htmlFor="ff-set-unknown-block-id">
          <input
            id="ff-set-unknown-block-id"
            readOnly
            value={block.id}
            className={FF_SET_INPUT_CLASS}
            aria-readonly="true"
          />
        </FieldRow>
      </div>
    );
  }

  return (
    <BlockSettingsLoaded
      block={block}
      docId={state.docId}
      blocks={state.body.blocks}
      ruleCount={state.body.logic.rules.filter((rule) => rule.scope === block.id).length}
      // §24 file-upload cap (follow-up #8): the plan's file_upload_max_mb;
      // null = entitlement unknown → the block schema ceiling applies.
      fileUploadCapMb={state.entitlements?.fileUploadMaxMb ?? null}
      dispatch={dispatch}
    />
  );
}

function BlockSettingsLoaded({
  block,
  docId,
  blocks,
  ruleCount,
  fileUploadCapMb,
  dispatch,
}: {
  block: Block;
  docId: string;
  blocks: readonly Block[];
  ruleCount: number;
  fileUploadCapMb: number | null;
  dispatch: ReturnType<typeof useBuilder>["dispatch"];
}) {
  // Registry lookup is deterministic per kind; the caller only renders this
  // component for known kinds — the null branch below is defensive.
  const def = getBlockDef(block.kind);

  // Parse stored props through the kind's schema; on failure pass the RAW
  // props to the editor plus an inline warning (broken blocks stay editable).
  const parsed = def ? def.propsSchema.safeParse(block.props) : null;
  const editorProps = parsed?.success ? parsed.data : block.props;

  // --- Behavior fields (question blocks; debounced text, §6.6) -------------
  // NOTE: every hook runs unconditionally (rules of hooks), even though the
  // question-only rows render conditionally further down.
  const props = block.props;
  const buttonText = typeof props["buttonText"] === "string" ? (props["buttonText"] as string) : "";
  const prefillParam = typeof props["prefillParam"] === "string" ? (props["prefillParam"] as string) : "";

  const updateProps = (next: Record<string, unknown>, label = "Edit settings"): void =>
    dispatch({
      type: "apply",
      ops: [{ op: "block.update", id: block.id, props: next }],
      label,
      coalesce: { key: `update:${block.id}`, at: Date.now() },
    });

  // NOTE: Editor.onChange hands us the FULL next props. block.update merges
  // shallowly, so sending the whole object is a valid patch (every key is
  // "replaced" with its current value) — simpler and exactly correct versus
  // diffing against the previous props.
  const handleEditorChange = (next: unknown): void => {
    updateProps(next as Record<string, unknown>);
  };

  const pushButtonText = useDebouncedPatch(
    (value) => [
      {
        op: "block.update",
        id: block.id,
        // Empty string unsets the key (schema requires min 1 char) — block.update
        // treats `null` as delete (§21).
        props: { ...props, buttonText: value === "" ? null : value },
      },
    ],
    { label: "Edit settings", coalesceKey: `update:${block.id}` },
  );
  const pushPrefill = useDebouncedPatch(
    (value) => [{ op: "block.update", id: block.id, props: { ...props, prefillParam: value === "" ? null : value } }],
    { label: "Edit settings", coalesceKey: `update:${block.id}` },
  );

  const [buttonTextDraft, setButtonTextDraft] = useDraftSync(buttonText);
  const [prefillDraft, setPrefillDraft] = useDraftSync(prefillParam);
  const [copied, setCopied] = useState(false);

  if (!def || !parsed) return null;

  const prefillFormatError =
    prefillDraft !== "" && !isValidPrefillParam(prefillDraft)
      ? "Must start with a letter; use letters, digits, _ or - (max 64)."
      : null;
  // Uniqueness is checked against the CURRENT doc (self excluded). The value
  // still autosaves — the error only styles the field (§6.6).
  const prefillConflictId = prefillFormatError === null ? prefillParamConflict(prefillDraft, blocks, block.id) : null;
  const prefillConflictError = prefillConflictId
    ? `Already used by block ${prefillConflictId} — prefill params must be unique.`
    : null;

  // §8.2 SENSITIVE_FIELD-style hint (warning only): label suggests password /
  // card number → abuse-policy note. Rendered under Content.
  const labelProp = props["label"];
  const sensitiveWarning = sensitiveLabelWarning(typeof labelProp === "string" ? labelProp : undefined);
  const isQuestion = def.family === "question";
  // §24 (follow-up #8): surface the plan's file_upload_max_mb on the relevant
  // settings field — the file-upload block's Max size editor caps at the
  // block schema ceiling; the plan cap (Business: 50 MB) is a server
  // entitlement, so the builder SHOWS the effective cap instead of editing it.
  const fileUploadCap =
    block.kind === "file-upload" ? (fileUploadCapMb ?? FILE_UPLOAD_BLOCK_MAX_MB) : null;

  return (
    <div className="ff-set-panel flex flex-col gap-4 p-3" data-testid="block-settings">
      <SettingsSection title="Content" testId="ff-set-content">
        <def.Editor
          blockId={block.id}
          props={editorProps}
          onChange={handleEditorChange}
          disabled={false}
        />
        {!parsed.success && (
          <InlineNote tone="warn" testId="ff-set-props-warning">
            Some fields could not be parsed — fix them here or reset the block below.
          </InlineNote>
        )}
        {sensitiveWarning && (
          <InlineNote tone="warn" testId="ff-set-sensitive-warning">
            {sensitiveWarning}
          </InlineNote>
        )}
        {fileUploadCap !== null && (
          <InlineNote tone="info" testId="ff-set-file-cap">
            {`Plan cap: up to ${fileUploadCap} MB per file on your plan.`}
          </InlineNote>
        )}
      </SettingsSection>

      {isQuestion && (
        <SettingsSection title="Behavior" testId="ff-set-block-behavior">
          <ToggleRow
            label="Required"
            checked={props["required"] === true}
            onChange={(next) => updateProps({ ...props, required: next })}
            testId="ff-set-required"
          />
          <FieldRow label="Button text" htmlFor="ff-set-button-text" hint="Leave empty to use the default.">
            <input
              id="ff-set-button-text"
              type="text"
              value={buttonTextDraft}
              data-testid="ff-set-button-text"
              className={FF_SET_INPUT_CLASS}
              onChange={(event) => {
                setButtonTextDraft(event.target.value);
                pushButtonText(event.target.value);
              }}
            />
          </FieldRow>
          <FieldRow
            label="Prefill param"
            htmlFor="ff-set-prefill-param"
            hint={`URL parameter that pre-fills this question, e.g. ?${prefillDraft || "param"}=value`}
            error={prefillFormatError ?? prefillConflictError}
          >
            <input
              id="ff-set-prefill-param"
              type="text"
              value={prefillDraft}
              placeholder="url_param_name"
              data-testid="ff-set-prefill-param"
              aria-invalid={prefillFormatError !== null || prefillConflictError !== null}
              className={FF_SET_INPUT_CLASS}
              onChange={(event) => {
                setPrefillDraft(event.target.value);
                pushPrefill(event.target.value);
              }}
            />
          </FieldRow>
        </SettingsSection>
      )}

      <SettingsSection title="Logic" testId="ff-set-logic">
        <p className="text-sm" data-testid="ff-set-logic-count">
          {ruleCount === 0
            ? "No rules start here."
            : ruleCount === 1
              ? "1 rule starts here"
              : `${ruleCount} rules start here`}
        </p>
        <a href={`/d/${docId}/logic`} className="ff-set-link text-sm" data-testid="ff-set-logic-link">
          Open Logic →
        </a>
      </SettingsSection>

      <SettingsSection title="Advanced" testId="ff-set-advanced">
        <FieldRow label="Block id" htmlFor="ff-set-block-id">
          <div className="flex gap-1">
            <input
              id="ff-set-block-id"
              readOnly
              value={block.id}
              aria-readonly="true"
              data-testid="ff-set-block-id"
              className={FF_SET_INPUT_CLASS}
            />
            <button
              type="button"
              className="ff-set-btn"
              aria-label="Copy block id"
              data-testid="ff-set-copy-id"
              onClick={() => {
                void copyTextToClipboard(block.id).then((ok) => {
                  if (ok) {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  }
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </FieldRow>
        <button
          type="button"
          className="ff-set-btn"
          data-testid="ff-set-reset-block"
          onClick={() =>
            // No coalesce: a distinct, deliberate action gets its own undo entry.
            dispatch({
              type: "apply",
              ops: [{ op: "block.update", id: block.id, props: def.defaultProps() as Record<string, unknown> }],
              label: "Reset block",
            })
          }
        >
          Reset to defaults
        </button>
      </SettingsSection>
    </div>
  );
}
