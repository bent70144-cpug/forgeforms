// packages/blocks — `faq` public renderer (server-safe).
// Native <details>/<summary>: interactive without client JS.
import type { FC } from "react";
import type { RenderProps } from "../registry";
import type { FaqProps } from "./schema";

export const FaqRender: FC<RenderProps<FaqProps>> = ({ props }) => {
  if (props.items.length === 0) return null;
  return (
    <div className="ff-faq" data-block-kind="faq">
      {props.items.map((item, index) => (
        <details key={`${item.q}-${index}`} className="ff-faq__item">
          <summary className="ff-faq__question">{item.q}</summary>
          <div className="ff-faq__answer">{item.a}</div>
        </details>
      ))}
    </div>
  );
};
