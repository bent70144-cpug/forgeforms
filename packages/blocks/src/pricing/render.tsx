// packages/blocks — `pricing` public renderer (server-safe).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { safeHref } from "../shared/safe-href";
import type { PricingProps } from "./schema";

export const PricingRender: FC<RenderProps<PricingProps>> = ({ props }) => {
  if (props.tiers.length === 0) return null;
  return (
    <div
      className="ff-pricing"
      data-block-kind="pricing"
      style={{ display: "grid", gridTemplateColumns: `repeat(${props.tiers.length}, minmax(0, 1fr))`, gap: "1.5rem" }}
    >
      {props.tiers.map((tier, index) => (
        <div key={`${tier.name}-${index}`} className="ff-pricing__tier">
          <h3 className="ff-pricing__name">{tier.name}</h3>
          {tier.price !== "" ? <p className="ff-pricing__price">{tier.price}</p> : null}
          {tier.features.length > 0 ? (
            <ul className="ff-pricing__features">
              {tier.features.map((feature, i) => (
                <li key={i}>{feature}</li>
              ))}
            </ul>
          ) : null}
          {tier.cta !== undefined ? (
            <a className="ff-pricing__cta" href={safeHref(tier.cta.href)}>
              {tier.cta.label}
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
};
