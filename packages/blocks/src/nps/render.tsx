// packages/blocks — `nps` public renderer (client-interactive, server-safe).
// OWNED BY T09 (issue #9).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { QuestionShell } from "../shared/question-editor-kit";
import { clampNps, prefillNps } from "./schema";
import type { NpsAnswer, NpsProps } from "./schema";

export const NpsRender: FC<RenderProps<NpsProps, NpsAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
  urlParams,
}) => {
  const current = answer ?? prefillNps(props, urlParams);
  const selected = typeof current === "number" && Number.isInteger(current) ? current : null;
  return (
    <QuestionShell
      kind="nps"
      label={props.label}
      required={props.required}
      description={props.description}
    >
      <div role="radiogroup" aria-label={props.label} data-nps-scale="0-10">
        {Array.from({ length: 11 }, (_, n) => n).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected === n}
            aria-label={`${n} out of 10`}
            data-value={n}
            disabled={disabled}
            // Every reported value passes through clampNps → always 0–10.
            onClick={() => onAnswer?.(clampNps(n))}
          >
            {n}
          </button>
        ))}
      </div>
      {props.leftLabel || props.rightLabel ? (
        <div className="ff-question__scale-labels">
          <span>{props.leftLabel}</span>
          <span>{props.rightLabel}</span>
        </div>
      ) : null}
    </QuestionShell>
  );
};
