// packages/blocks — `email` props + answer schema (spec §7.2: label, required;
// answer: string (email)) + generic question props. OWNED BY T09 (issue #9).
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";
import { rawParam, type UrlParams } from "../shared/prefill";

export const EmailProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
});

export type EmailProps = z.infer<typeof EmailProps>;

// §7.2 "Answer value: string (email)". Format lives in the schema so ingest
// rejects non-emails before `validate` runs (mirrors the ingest bootstrap
// registry's z.email() answerSchema).
export const EmailAnswer = z.email();

export type EmailAnswer = z.infer<typeof EmailAnswer>;

export function validateEmail(answer: string, props: EmailProps): string | null {
  if (props.required && answer.trim() === "") {
    return "This field is required";
  }
  if (answer.trim() !== "" && !EmailAnswer.safeParse(answer.trim()).success) {
    return "Enter a valid email address";
  }
  return null;
}

/** Prefill from the `prefillParam` URL param — only when it parses as an email. */
export function prefillEmail(props: EmailProps, params: UrlParams): EmailAnswer | undefined {
  const raw = rawParam(params, props.prefillParam);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return EmailAnswer.safeParse(trimmed).success ? trimmed : undefined;
}

export const emailDefaultProps = (): EmailProps => ({
  label: "Email address",
  required: false,
});
