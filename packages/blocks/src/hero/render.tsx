// packages/blocks — `hero` public renderer (server-safe).
// OWNED BY T06 (issue #6).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { safeHref } from "../shared/safe-href";
import type { HeroProps } from "./schema";

export const HeroRender: FC<RenderProps<HeroProps>> = ({ props }) => (
  <section className="ff-hero" data-block-kind="hero">
    {props.imageAssetId ? (
      <div className="ff-hero__media" data-asset-id={props.imageAssetId} />
    ) : null}
    <h1 className="ff-hero__title">{props.title}</h1>
    {props.subtitle ? <p className="ff-hero__subtitle">{props.subtitle}</p> : null}
    {props.cta ? (
      <a className="ff-hero__cta" href={safeHref(props.cta.href)}>
        {props.cta.label}
      </a>
    ) : null}
  </section>
);
