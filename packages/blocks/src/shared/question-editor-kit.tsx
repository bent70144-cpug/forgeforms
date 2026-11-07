// packages/blocks — shared pieces for question-block builder editors
// (spec §7.2: every question block has canvas preview + settings, with the
// generic props description/required/buttonText/imageAssetId/prefillParam).
// OWNED BY T09 (issue #9).
import { useState, type ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { Option } from "./option-list";
import { MAX_OPTIONS } from "./option-list";
import type { UrlParams } from "./prefill";

/* ------------------------------------------------------------------------- *
 * §10 asset-picker host seam (builder audit §9.1/§10 follow-up).
 *
 * The package cannot own the picker UI (it lives in the host builder, which
 * talks to the presign/confirm API), so editors call `pickImageAsset()` and
 * the HOST registers an opener via `setAssetPickerOpener()` (same seam
 * posture as file-upload's `setFileUploadClient`). Without a host the picker
 * resolves null and the row stays manual-edit only.
 * ------------------------------------------------------------------------- */

/** What a successful pick resolves with: the asset reference (+ alt text when
 * the target prop supports it — question `imageAssetId` is a plain string and
 * does NOT; gallery's ImageAssetRef record does). */
export type AssetPickResult = { assetId: string; alt?: string };

export type AssetPickerOpener = (options?: {
  /** Target prop can store alt text → the host shows the §10 alt prompt. */
  supportsAlt?: boolean;
}) => Promise<AssetPickResult | null>;

let assetPickerOpener: AssetPickerOpener | null = null;

/** Host registration: mount the AssetPicker modal once, register it here. */
export function setAssetPickerOpener(opener: AssetPickerOpener | null): void {
  assetPickerOpener = opener;
}

/** Open the host's asset picker; resolves null when no host is registered or
 * the user cancels. Fire-and-forget safe (`void pickImageAsset(...)`). */
export function pickImageAsset(supportsAlt = false): Promise<AssetPickResult | null> {
  if (!assetPickerOpener) return Promise.resolve(null);
  return assetPickerOpener({ supportsAlt });
}

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
      {/* §9.1 image row — manual id entry + the §10 host picker (keeps the
          raw input so hosts without a registered picker still work). */}
      <div className="ff-editor__field">
        <span>Image asset</span>
        <div className="ff-editor__image-row" data-image-row>
          <input
            type="text"
            value={props.imageAssetId ?? ""}
            aria-label="Image asset id"
            disabled={disabled}
            onChange={(event) => onPatch({ imageAssetId: event.target.value || undefined })}
          />
          <button
            type="button"
            className="ff-editor__image-choose"
            disabled={disabled}
            onClick={() => {
              void pickImageAsset(false).then((pick) => {
                if (pick) onPatch({ imageAssetId: pick.assetId });
              });
            }}
          >
            Choose image…
          </button>
          {props.imageAssetId ? (
            <button
              type="button"
              aria-label="Remove image"
              disabled={disabled}
              onClick={() => onPatch({ imageAssetId: undefined })}
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>
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

// --- §9.3 option-list interactions (W10) -------------------------------------
// Enter-adds-below, Backspace-on-empty-deletes, multi-line paste split and the
// inline duplicate-label warning for `OptionsFields`. Publish stays the
// enforcement point (DUP_OPTION / NO_OPTIONS); everything here is a live,
// non-blocking authoring affordance.

/** Hard cap for the options list — mirrors `OptionList.max` (shared/option-list.ts). */
export const OPTION_LIST_MAX = 200;

/** Split pasted text into non-empty, trimmed lines (CRLF / CR / LF aware). */
export function splitPasteLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Non-empty labels used on 2+ options — trimmed, exact match, in order of the
 * first duplicate. Mirrors the publish-time DUP_OPTION check exactly so the
 * inline warning never disagrees with the publish gate.
 */
export function duplicateOptionLabels(options: readonly Option[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const option of options) {
    const label = option.label.trim();
    if (label === "") continue;
    if (seen.has(label)) duplicates.add(label);
    seen.add(label);
  }
  return [...duplicates];
}

export type PasteSplitResult = {
  options: Option[];
  /** Index of the first newly inserted row (focus target); null when nothing was added. */
  focusIndex: number | null;
  /** Rows that were added (first pasted line goes into the pasted-into row). */
  added: number;
  /** Lines left out because the list hit the cap. */
  dropped: number;
};

/**
 * Merge pasted lines into the option list (§9.3 paste-split): the first line
 * lands in the pasted-into row (its id stays stable), every following line
 * becomes a new option directly below it with a fresh id (via `makeId`).
 *
 * The total row count never exceeds `max` (mirrors `OptionList.max`): the
 * list absorbs at most `max - options.length + 1` lines — the +1 because the
 * first line reuses the existing row — and excess lines are reported as
 * `dropped` so the editor can surface the §14 paste-cap note.
 */
export function splitPastedOptions(
  options: readonly Option[],
  index: number,
  pastedLines: readonly string[],
  makeId: (existing: readonly Option[]) => string,
  max: number = OPTION_LIST_MAX,
): PasteSplitResult {
  if (pastedLines.length === 0) {
    return { options: [...options], focusIndex: null, added: 0, dropped: 0 };
  }
  if (options.length === 0) {
    // Defensive: OptionList requires ≥1 option, so callers never hit this.
    const used = Math.min(pastedLines.length, max);
    const appended: Option[] = [];
    for (let k = 0; k < used; k++) {
      const id = makeId(appended);
      appended.push({ id, label: pastedLines[k] ?? "" });
    }
    return {
      options: appended,
      focusIndex: used > 0 ? 0 : null,
      added: used,
      dropped: pastedLines.length - used,
    };
  }
  const target = Math.min(Math.max(index, 0), options.length - 1);
  // At least one line always lands (in the pasted-into row).
  const used = Math.min(pastedLines.length, Math.max(max - options.length + 1, 1));
  // Fresh ids are minted against ALL existing ids (not just the rebuilt prefix).
  const idPool: Option[] = [...options];
  const freshIds: string[] = [];
  for (let k = 1; k < used; k++) {
    const id = makeId(idPool);
    idPool.push({ id, label: "" });
    freshIds.push(id);
  }
  const rebuilt: Option[] = [];
  options.forEach((option, i) => {
    if (i !== target) {
      rebuilt.push(option);
      return;
    }
    rebuilt.push({ ...option, label: pastedLines[0] ?? "" });
    for (let k = 1; k < used; k++) {
      const id = freshIds[k - 1];
      if (id !== undefined) rebuilt.push({ id, label: pastedLines[k] ?? "" });
    }
  });
  const added = used - 1;
  return {
    options: rebuilt,
    focusIndex: added > 0 ? target + 1 : null,
    added,
    dropped: pastedLines.length - used,
  };
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
  // §14 non-blocking note (paste cap / option limit) — never blocks editing.
  const [note, setNote] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef<number | null>(null);

  // §9.3 keyboard/paste interactions usually target a row that mounts in the
  // same commit (Enter-add below, Backspace-delete, paste-split), so the focus
  // decision is recorded during the event and applied after the re-render.
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const index = pendingFocus.current;
    pendingFocus.current = null;
    inputRefs.current[index]?.focus();
  });

  const atCap = options.length >= OPTION_LIST_MAX;
  const duplicates = duplicateOptionLabels(options);

  const relabel = (index: number, label: string): void => {
    onOptionsChange(options.map((option, i) => (i === index ? { ...option, label } : option)));
  };
  const remove = (index: number): void => {
    // OptionList requires ≥1 option — never remove the last row.
    if (options.length <= 1) return;
    // Dropping a row always frees capacity — clear a stale cap note.
    setNote(null);
    onOptionsChange(options.filter((_, i) => i !== index));
  };
  const add = (): void => {
    if (atCap) return; // the button is disabled at the cap anyway (defense)
    setNote(null);
    onOptionsChange([
      ...options,
      { id: nextOptionId(options), label: `Option ${options.length + 1}` },
    ]);
  };

  // §9.3: Enter adds an empty option directly below and focuses it.
  const addBelow = (index: number): void => {
    if (disabled) return;
    if (atCap) {
      setNote(`Option limit reached (${OPTION_LIST_MAX}).`);
      return;
    }
    pendingFocus.current = index + 1;
    setNote(null);
    onOptionsChange([
      ...options.slice(0, index + 1),
      { id: nextOptionId(options), label: "" },
      ...options.slice(index + 1),
    ]);
  };

  // §9.3: Backspace on an EMPTY option deletes it and focuses the previous
  // row (the new row 0 when the first row goes); the last remaining option
  // can never be deleted this way (OptionList min 1).
  const backspaceEmpty = (index: number): void => {
    if (disabled) return;
    if ((options[index]?.label ?? "") !== "") return;
    if (options.length <= 1) return;
    pendingFocus.current = Math.max(index - 1, 0);
    setNote(null);
    onOptionsChange(options.filter((_, i) => i !== index));
  };

  // §9.3 + §14: multi-line paste splits into one option per line (fresh ids,
  // capped at the OptionList limit); beyond the cap keep what fits and surface
  // a non-blocking note instead of dropping the paste silently.
  const pasteSplit = (index: number, lines: string[]): void => {
    if (disabled) return;
    const result = splitPastedOptions(options, index, lines, (existing) => nextOptionId(existing));
    pendingFocus.current = result.focusIndex;
    setNote(
      result.dropped > 0
        ? `Option limit reached (${OPTION_LIST_MAX}) — kept ${result.added + 1} of ${lines.length} pasted lines.`
        : null,
    );
    onOptionsChange(result.options);
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
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            onChange={(event) => relabel(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addBelow(index);
              } else if (event.key === "Backspace") {
                backspaceEmpty(index);
              }
            }}
            onPaste={(event) => {
              const data = event.clipboardData;
              if (data === null || disabled) return;
              const lines = splitPasteLines(data.getData("text/plain"));
              if (lines.length < 2) return; // single line → native paste + onChange
              event.preventDefault();
              pasteSplit(index, lines);
            }}
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
      {duplicates.length > 0 ? (
        <p className="ff-editor__hint ff-editor__hint--warn" role="note">
          Duplicate option label{duplicates.length > 1 ? "s" : ""}:{" "}
          {duplicates.map((label) => `“${label}”`).join(", ")} — publish blocks duplicates (DUP_OPTION).
        </p>
      ) : null}
      {note ? (
        <p className="ff-editor__hint" role="note">
          {note}
        </p>
      ) : null}
      <button type="button" disabled={disabled || atCap} onClick={add}>
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
