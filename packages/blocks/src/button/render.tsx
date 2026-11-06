// packages/blocks — `button` public renderer (server-safe).
// OWNED BY T06 (issue #6).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { safeHref } from "../shared/safe-href";
import type { ButtonProps } from "./schema";

export const ButtonRender: FC<RenderProps<ButtonProps>> = ({ props }) => (
  <a
    className={`ff-button ff-button--${props.style}`}
    data-block-kind="button"
    href={safeHref(props.href)}
  >
    {props.label}
  </a>
);
