// packages/blocks — shared pieces for question-block builder editors
// (spec §7.2: every question block has canvas preview + settings, with the
// generic props description/required/buttonText/imageAssetId/prefillParam).
// OWNED BY T09 (issue #9).
import { useState, type ReactNode } from "react";
import type { Option } from "./option-list";
import { MAX_OPTIONS } from "./option-list";
import type { UrlParams } from "./prefill";

/**
 * Common question markup: data-block-kind + description + required asterisk.
 * Each render component nests its input inside `children`.
 */
export function QuestionShell({
  kind,
  label,
  required,
  description,
  children,
}: {
  kind: string;
  label: string;
  required?: boolean;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className={`ff-question ff-question--${kind}`} data-block-kind={kind}>
      {description ? <p className="ff-question__description">{description}</p> : null}
      <div className="ff-question__field">
        <span className="ff-question__label">
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </span>
        {children}
      </div>
    </div>
  );
}

/** Patch of the generic question props an editor can apply in one go. */
export type GenericQuestionPatch = {
  description?: string | undefined;
  required?: boolean;
  buttonText?: string | undefined;
  imageAssetId?: string | undefined;
  prefillParam?: string | undefined;
};

/** Settings fields shared by every question block's editor. */
export function GenericQuestionFields({
  props,
  onPatch,
  disabled,
}: {
  props: {
    description?: string;
    required: boolean;
    buttonText?: string;
    imageAssetId?: string;
    prefillParam?: string;
  };
  onPatch: (patch: GenericQuestionPatch) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ff-editor__generic">
      <label className="ff-editor__field">
        <span>Description</span>
        <textarea
          value={props.description ?? ""}
          disabled={disabled}
          onChange={(event) => onPatch({ description: event.target.value || undefined })}
        />
      </label>
      <label className="ff-editor__field ff-editor__field--checkbox">
        <input
          type="checkbox"
          checked={props.required}
          disabled={disabled}
          onChange={(event) => onPatch({ required: event.target.checked })}
        />
        <span>Required</span>
      </label>
      <label className="ff-editor__field">
        <span>Button text</span>
        <input
          type="text"
          value={props.buttonText ?? ""}
          disabled={disabled}
          onChange={(event) => onPatch({ buttonText: event.target.value || undefined })}
        />
      </label>
      <label className="ff-editor__field">
        <span>Image asset</span>
        <input
          type="text"
          value={props.imageAssetId ?? ""}
          disabled={disabled}
          onChange={(event) => onPatch({ imageAssetId: event.target.value || undefined })}
        />
      </label>
      <label className="ff-editor__field">
        <span>Prefill param</span>
        <input
          type="text"
          value={props.prefillParam ?? ""}
          placeholder="url_param_name"
          disabled={disabled}
          onChange={(event) => onPatch({ prefillParam: event.target.value || undefined })}
        />
      </label>
    </div>
  );
}

/**
 * Canvas preview inside an editor: renders the block's public renderer with a
 * `?prefillParam=sample` box (shown when the author configured a prefillParam)
 * so the prefill behavior is previewable without leaving the builder.
 *
 * `urlParams` (when provided by the host builder, e.g. live preview params)
 * wins over the internal sample.
 */
export function CanvasPreview({
  kind,
  prefillParam,
  disabled,
  urlParams,
  children,
}: {
  kind: string;
  prefillParam?: string;
  disabled?: boolean;
  urlParams?: UrlParams;
  children: (effectiveParams: Record<string, string> | undefined) => ReactNode;
}) {
  const [sample, setSample] = useState("");
  const effective =
    urlParams ??
    (prefillParam && sample !== "" ? { [prefillParam]: sample } : undefined);
  return (
    <div className="ff-editor__canvas" data-editor-canvas={kind}>
      {prefillParam ? (
        <label className="ff-editor__field ff-editor__field--prefill">
          <span>Prefill sample ?{prefillParam}=</span>
          <input
            type="text"
            value={sample}
            disabled={disabled}
            onChange={(event) => setSample(event.target.value)}
          />
        </label>
      ) : null}
      <div className="ff-editor__canvas-body">{children(effective)}</div>
    </div>
  );
}

let optionCounter = 0;
function nextOptionId(existing: readonly Option[]): string {
  optionCounter += 1;
  let id = `opt_${Date.now().toString(36)}_${optionCounter}`;
  while (existing.some((option) => option.id === id)) id = `${id}x`;
  return id;
}

/** Optional numeric settings field (min/max/maxLength): blank ⇔ undefined. */
export function OptionalNumberField({
  label,
  value,
  min,
  max,
  disabled,
  onValue,
}: {
  label: string;
  value: number | undefined;
  min?: number;
  max?: number;
  disabled?: boolean;
  onValue: (next: number | undefined) => void;
}) {
  return (
    <label className="ff-editor__field">
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onValue(undefined);
            return;
          }
          const parsed = Number(raw);
          onValue(Number.isFinite(parsed) ? parsed : undefined);
        }}
      />
    </label>
  );
}

/** Options list editor shared by single-select / multi-select / dropdown. */
export function OptionsFields({
  options,
  onOptionsChange,
  disabled,
}: {
  options: Option[];
  onOptionsChange: (next: Option[]) => void;
  disabled?: boolean;
}) {
  const relabel = (index: number, label: string): void => {
    onOptionsChange(options.map((option, i) => (i === index ? { ...option, label } : option)));
  };
  const remove = (index: number): void => {
    // OptionList requires ≥1 option — never remove the last row.
    if (options.length <= 1) return;
    onOptionsChange(options.filter((_, i) => i !== index));
  };
  const add = (): void => {
    onOptionsChange([
      ...options,
      { id: nextOptionId(options), label: `Option ${options.length + 1}` },
    ]);
  };
  return (
    <div className="ff-editor__options" data-options-editor>
      {options.map((option, index) => (
        <div key={option.id} className="ff-editor__option-row">
          <input
            type="text"
            value={option.label}
            disabled={disabled}
            aria-label={`Option ${index + 1} label`}
            onChange={(event) => relabel(index, event.target.value)}
          />
          <button
            type="button"
            disabled={disabled || options.length <= 1}
            onClick={() => remove(index)}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" disabled={disabled} onClick={add}>
        Add option
      </button>
    </div>
  );
}

/**
 * §9.2 dropdown bulk-paste: turn a pasted newline-separated list into options.
 *
 * Pure editor-plane helper (no renderer change): lines are trimmed, blank lines
 * dropped, labels deduplicated against the existing options and within the
 * paste itself (case-sensitive exact match, mirroring findOption's exactness),
 * and ids are minted with the same stable scheme as "Add option". The merged
 * list is hard-capped at the shared MAX_OPTIONS limit so the result is always
 * OptionList-valid.
 */
export function parsePastedOptions(text: string, existing: readonly Option[] = []): Option[] {
  const seen = new Set(existing.map((option) => option.label));
  const merged: Option[] = [...existing];
  for (const rawLine of text.split(/\r?\n/)) {
    if (merged.length >= MAX_OPTIONS) break;
    const label = rawLine.trim();
    if (label === "" || seen.has(label)) continue;
    seen.add(label);
    merged.push({ id: nextOptionId(merged), label });
  }
  return merged;
}

/**
 * §9.2 dropdown bulk-paste editor control: a "Paste options" disclosure with a
 * textarea (one option per line) and an apply button that merges the parsed
 * lines into the current options. Shared so other select-kind editors can
 * adopt it later; dropdown ships it first.
 */
export function PasteOptionsFields({
  options,
  onOptionsChange,
  disabled,
}: {
  options: Option[];
  onOptionsChange: (next: Option[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const merged = parsePastedOptions(text, options);
  const newCount = merged.length - options.length;
  return (
    <div className="ff-editor__paste" data-paste-options>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Paste options
      </button>
      {open ? (
        <>
          <textarea
            className="ff-editor__paste-input"
            aria-label="Paste options, one per line"
            placeholder={"One option per line, e.g.\nRed\nGreen\nBlue"}
            rows={6}
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
          />
          <button
            type="button"
            disabled={disabled || newCount === 0}
            onClick={() => {
              onOptionsChange(merged);
              setText("");
              setOpen(false);
            }}
          >
            {`Add ${newCount} ${newCount === 1 ? "option" : "options"}`}
          </button>
        </>
      ) : null}
    </div>
  );
}
