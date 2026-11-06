// packages/blocks — `email` block definition; registers at import time (§7.1).
// OWNED BY T09 (issue #9).
import { registerBlock, type BlockDef } from "../registry";
import { EmailEditor } from "./editor";
import { EmailRender } from "./render";
import { EmailAnswer, EmailProps, emailDefaultProps, validateEmail } from "./schema";

export const emailBlock: BlockDef<EmailProps, EmailAnswer> = {
  kind: "email",
  family: "question",
  label: "Email",
  icon: "mail",
  propsSchema: EmailProps,
  defaultProps: emailDefaultProps,
  answerSchema: EmailAnswer,
  validate: validateEmail,
  Editor: EmailEditor,
  Render: EmailRender,
};

registerBlock(emailBlock);
