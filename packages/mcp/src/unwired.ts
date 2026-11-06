// packages/mcp/src/unwired.ts
// INTEGRATION-DEBT: awaiting T02/T25.
// The MCP server is fully functional against injected services (see
// test/e2e.test.ts), but the real FormForge backend is produced by T02
// (kernel + documents/submissions modules) and T25 (API tokens). Until the
// lead's integration ticket wires them, the default composition root uses
// these fail-loud adapters: the server starts, advertises its 7 tools, and
// every call returns a clear INTERNAL error instead of pretending to work.
//
// Wiring point: replace these in src/main.ts with the real implementations —
//   tokens:      T25 TokenResolver (sha256 lookup → workspaceId + scopes)
//   documents:   @formforge/core documents module
//   submissions: @formforge/core submissions module
import { AppError, err } from "@formforge/core";
import type { DocumentService, SubmissionService, TokenResolver } from "./services.ts";

const failure = () =>
  err(
    new AppError(
      "INTERNAL",
      "INTEGRATION-DEBT: FormForge backend not wired into the MCP server yet — awaiting T02 (kernel/services) and T25 (API tokens). Inject real TokenResolver/DocumentService/SubmissionService via createMcpServer(deps) in packages/mcp/src/main.ts.",
    ),
  );

export const unwiredTokenResolver: TokenResolver = {
  async resolve() {
    return failure();
  },
};

export const unwiredDocuments: DocumentService = {
  async listDocuments() {
    return failure();
  },
  async getDocument() {
    return failure();
  },
  async createDocument() {
    return failure();
  },
  async applyOps() {
    return failure();
  },
  async publishDocument() {
    return failure();
  },
};

export const unwiredSubmissions: SubmissionService = {
  async listSubmissions() {
    return failure();
  },
  async summarizeResponses() {
    return failure();
  },
};
