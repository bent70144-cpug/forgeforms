// packages/blocks — `file-upload` block definition; registers at import time (§7.1).
// T16 (issue #16) — spec §7.2 question row: label, accept[], maxSizeMb(≤10),
// maxFiles; answer { assetIds: string[] }.
import { registerBlock, type BlockDef } from "../registry";
import { FileUploadEditor } from "./editor";
import { FileUploadRender } from "./render";
import {
  FileUploadAnswer,
  FileUploadProps,
  fileUploadDefaultProps,
  validateFileUpload,
} from "./schema";

export const fileUploadBlock: BlockDef<FileUploadProps, FileUploadAnswer> = {
  kind: "file-upload",
  family: "question",
  label: "File upload",
  icon: "paperclip",
  propsSchema: FileUploadProps,
  defaultProps: fileUploadDefaultProps,
  answerSchema: FileUploadAnswer,
  validate: validateFileUpload,
  Editor: FileUploadEditor,
  Render: FileUploadRender,
};

registerBlock(fileUploadBlock);
