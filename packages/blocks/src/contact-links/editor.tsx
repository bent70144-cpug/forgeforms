// packages/blocks — `contact-links` builder editor (settings panel; T08 owns layout).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { ContactLink, ContactLinkType, ContactLinksProps } from "./schema";

const TYPES: Array<{ value: ContactLinkType; label: string }> = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "website", label: "Website" },
  { value: "github", label: "GitHub" },
  { value: "x", label: "X" },
  { value: "twitter", label: "Twitter" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "dribbble", label: "Dribbble" },
  { value: "other", label: "Other" },
];

function emptyLink(): ContactLink {
  return { type: "website", url: "" };
}

export const ContactLinksEditor: FC<EditorProps<ContactLinksProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--contact-links" data-kind="contact-links">
    <p className="ff-editor__hint">{props.links.length} link(s)</p>
    {props.links.map((link, index) => (
      <fieldset key={index} className="ff-editor__group">
        <legend>Link {index + 1}</legend>
        <label className="ff-editor__field">
          <span>Type</span>
          <select
            value={link.type}
            disabled={disabled}
            onChange={(event) => {
              const links = [...props.links];
              links[index] = { ...link, type: event.target.value as ContactLinkType };
              onChange({ ...props, links });
            }}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ff-editor__field">
          <span>URL / handle</span>
          <input
            type="text"
            value={link.url}
            disabled={disabled}
            onChange={(event) => {
              const links = [...props.links];
              links[index] = { ...link, url: event.target.value };
              onChange({ ...props, links });
            }}
          />
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...props, links: props.links.filter((_, i) => i !== index) })}
        >
          Remove
        </button>
      </fieldset>
    ))}
    <button
      type="button"
      disabled={disabled || props.links.length >= 20}
      onClick={() => onChange({ ...props, links: [...props.links, emptyLink()] })}
    >
      Add link
    </button>
  </div>
);
