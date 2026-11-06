// packages/blocks — `projects` builder editor (settings panel; T08 owns layout).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { ProjectItem, ProjectsProps } from "./schema";

function emptyItem(): ProjectItem {
  return { title: "", description: "", tags: [] };
}

export const ProjectsEditor: FC<EditorProps<ProjectsProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--projects" data-kind="projects">
    <p className="ff-editor__hint">{props.items.length} project(s)</p>
    {props.items.map((item, index) => (
      <fieldset key={index} className="ff-editor__group">
        <legend>Project {index + 1}</legend>
        <label className="ff-editor__field">
          <span>Title</span>
          <input
            type="text"
            value={item.title}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              items[index] = { ...item, title: event.target.value };
              onChange({ ...props, items });
            }}
          />
        </label>
        <label className="ff-editor__field">
          <span>Description</span>
          <textarea
            rows={3}
            value={item.description}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              items[index] = { ...item, description: event.target.value };
              onChange({ ...props, items });
            }}
          />
        </label>
        <label className="ff-editor__field">
          <span>Cover asset id</span>
          <input
            type="text"
            value={typeof item.coverAssetId === "string" ? item.coverAssetId : item.coverAssetId?.assetId ?? item.coverAssetId?.src ?? ""}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              const value = event.target.value.trim();
              items[index] = { ...item, coverAssetId: value === "" ? undefined : value };
              onChange({ ...props, items });
            }}
          />
        </label>
        <label className="ff-editor__field">
          <span>Link</span>
          <input
            type="url"
            value={item.link ?? ""}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              const value = event.target.value.trim();
              items[index] = { ...item, link: value === "" ? undefined : value };
              onChange({ ...props, items });
            }}
          />
        </label>
        <label className="ff-editor__field">
          <span>Tags (comma separated)</span>
          <input
            type="text"
            value={item.tags.join(", ")}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              items[index] = {
                ...item,
                tags: event.target.value.split(",").map((t) => t.trim()).filter((t) => t !== ""),
              };
              onChange({ ...props, items });
            }}
          />
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...props, items: props.items.filter((_, i) => i !== index) })}
        >
          Remove
        </button>
      </fieldset>
    ))}
    <button
      type="button"
      disabled={disabled || props.items.length >= 50}
      onClick={() => onChange({ ...props, items: [...props.items, emptyItem()] })}
    >
      Add project
    </button>
  </div>
);
