// packages/blocks — `gallery` builder editor (settings panel; T08 owns layout).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import { pickImageAsset } from "../shared/question-editor-kit";
import type { GalleryLayout, GalleryProps } from "./schema";

const LAYOUTS: Array<{ value: GalleryLayout; label: string }> = [
  { value: "grid", label: "Grid" },
  { value: "masonry", label: "Masonry" },
];

export const GalleryEditor: FC<EditorProps<GalleryProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--gallery" data-kind="gallery">
    <label className="ff-editor__field">
      <span>Assets (one id/URL per line)</span>
      <textarea
        rows={4}
        disabled={disabled}
        value={props.assetIds.map((ref) => (typeof ref === "string" ? ref : ref.src ?? ref.assetId ?? "")).join("\n")}
        onChange={(event) =>
          onChange({
            ...props,
            assetIds: event.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== ""),
          })
        }
      />
    </label>
    {/* §10 asset picker: the manual textarea above stays the power-user path;
        "Add image…" resolves through the host picker. Gallery refs support alt
        text (ImageAssetRef record) → supportsAlt=true. */}
    <button
      type="button"
      className="ff-editor__image-choose"
      disabled={disabled}
      data-testid="gallery-add-image"
      onClick={() => {
        void pickImageAsset(true).then((pick) => {
          if (!pick) return;
          onChange({
            ...props,
            assetIds: [
              ...props.assetIds,
              pick.alt ? { assetId: pick.assetId, alt: pick.alt } : pick.assetId,
            ],
          });
        });
      }}
    >
      Add image…
    </button>
    <label className="ff-editor__field">
      <span>Layout</span>
      <select
        value={props.layout}
        disabled={disabled}
        onChange={(event) => onChange({ ...props, layout: event.target.value as GalleryLayout })}
      >
        {LAYOUTS.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
    <label className="ff-editor__field">
      <span>Columns (1–6)</span>
      <input
        type="number"
        min={1}
        max={6}
        value={props.columns}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 6) onChange({ ...props, columns: parsed });
        }}
      />
    </label>
  </div>
);
