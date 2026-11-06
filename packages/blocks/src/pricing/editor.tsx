// packages/blocks — `pricing` builder editor (settings panel; T08 owns layout).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { PricingProps, PricingTier } from "./schema";

function emptyTier(): PricingTier {
  return { name: "", price: "", features: [] };
}

export const PricingEditor: FC<EditorProps<PricingProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--pricing" data-kind="pricing">
    <p className="ff-editor__hint">{props.tiers.length} tier(s)</p>
    {props.tiers.map((tier, index) => (
      <fieldset key={index} className="ff-editor__group">
        <legend>Tier {index + 1}</legend>
        <label className="ff-editor__field">
          <span>Name</span>
          <input
            type="text"
            value={tier.name}
            disabled={disabled}
            onChange={(event) => {
              const tiers = [...props.tiers];
              tiers[index] = { ...tier, name: event.target.value };
              onChange({ ...props, tiers });
            }}
          />
        </label>
        <label className="ff-editor__field">
          <span>Price</span>
          <input
            type="text"
            value={tier.price}
            disabled={disabled}
            onChange={(event) => {
              const tiers = [...props.tiers];
              tiers[index] = { ...tier, price: event.target.value };
              onChange({ ...props, tiers });
            }}
          />
        </label>
        <label className="ff-editor__field">
          <span>Features (one per line)</span>
          <textarea
            rows={3}
            value={tier.features.join("\n")}
            disabled={disabled}
            onChange={(event) => {
              const tiers = [...props.tiers];
              tiers[index] = {
                ...tier,
                features: event.target.value.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
              };
              onChange({ ...props, tiers });
            }}
          />
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...props, tiers: props.tiers.filter((_, i) => i !== index) })}
        >
          Remove
        </button>
      </fieldset>
    ))}
    <button
      type="button"
      disabled={disabled || props.tiers.length >= 10}
      onClick={() => onChange({ ...props, tiers: [...props.tiers, emptyTier()] })}
    >
      Add tier
    </button>
  </div>
);
