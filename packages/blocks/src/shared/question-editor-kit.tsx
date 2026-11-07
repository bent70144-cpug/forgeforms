// packages/blocks — shared pieces for question-block builder editors
// (spec §7.2: every question block has canvas preview + settings, with the
// generic props description/required/buttonText/imageAssetId/prefillParam).
// OWNED BY T09 (issue #9).
import { useState, type ReactNode } from "react";
import type { Option } from "./option-list";
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
