import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, buildRedactPaths, LOG_DENYLIST } from "./logger.ts";

type CapturedLine = Record<string, unknown>;

function captureLogs() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const lines = (): CapturedLine[] =>
    chunks
      .join("")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as CapturedLine);
  return { stream, lines };
}

const SECRET_VALUES = [
  "hunter2-password",
  "tok_super-secret-value",
  "sekret-value",
  "answer-text-the-user-typed",
  "sk_live_never_leak",
];

describe("logger", () => {
  afterEach(() => {
    delete process.env.LOG_LEVEL;
  });

  it("builds redact paths for every denylist key", () => {
    const paths = buildRedactPaths(["password", "token"]);
    expect(paths).toContain("password");
    expect(paths).toContain("*.password");
    expect(paths).toContain("*.*.token");
    expect(paths).toContain("token[*]");
    // full denylist is expanded by default
    expect(buildRedactPaths().length).toBeGreaterThanOrEqual(LOG_DENYLIST.length * 6);
  });

  it("removes denylist keys at the top level (password, token, secret, answers)", () => {
    const { stream, lines } = captureLogs();
    const log = createLogger({}, { level: "info", stream });
    log.info(
      {
        event: "test.top",
        password: SECRET_VALUES[0],
        token: SECRET_VALUES[1],
        secret: SECRET_VALUES[2],
        answers: [{ block: "b1", value: SECRET_VALUES[3] }],
        value: SECRET_VALUES[3],
        safe: "keep me",
      },
      "top-level redaction",
    );
    const [line] = lines();
    expect(line).toBeDefined();
    const raw = JSON.stringify(line);
    for (const secret of SECRET_VALUES) expect(raw).not.toContain(secret);
    expect(line!["password"]).toBeUndefined();
    expect(line!["token"]).toBeUndefined();
    expect(line!["secret"]).toBeUndefined();
    expect(line!["answers"]).toBeUndefined();
    expect(line!["value"]).toBeUndefined();
    expect(line!["safe"]).toBe("keep me");
  });

  it("removes denylist keys nested in request bodies (req.body.password)", () => {
    const { stream, lines } = captureLogs();
    const log = createLogger({}, { level: "info", stream });
    log.info(
      {
        req: {
          method: "POST",
          body: { email: "a@b.c", password: SECRET_VALUES[0], answer: SECRET_VALUES[3] },
        },
      },
      "nested redaction",
    );
    const [line] = lines();
    const raw = JSON.stringify(line);
    expect(raw).not.toContain(SECRET_VALUES[0]);
    expect(raw).not.toContain(SECRET_VALUES[3]);
    const body = (line!["req"] as { body?: Record<string, unknown> })["body"];
    expect(body?.["email"]).toBe("a@b.c");
    expect(body?.["password"]).toBeUndefined();
    expect(body?.["answer"]).toBeUndefined();
  });

  it("strips secrets from arrays of objects (e.g. per-block values)", () => {
    const { stream, lines } = captureLogs();
    const log = createLogger({}, { level: "info", stream });
    log.info(
      {
        blocks: [
          { id: "b1", token_hash: SECRET_VALUES[1] },
          { id: "b2", ok: true },
        ],
      },
      "array redaction",
    );
    const raw = JSON.stringify(lines());
    expect(raw).not.toContain(SECRET_VALUES[1]);
    expect(raw).toContain("b1");
  });

  it("binds requestId/workspaceId/documentId onto every line", () => {
    const { stream, lines } = captureLogs();
    const log = createLogger(
      { requestId: "req_123", workspaceId: "ws_abc", documentId: "doc_xyz" },
      { level: "info", stream },
    );
    log.info("first");
    log.child({ span: "child" }).info("second");
    const all = lines();
    expect(all[0]).toMatchObject({ requestId: "req_123", workspaceId: "ws_abc", documentId: "doc_xyz" });
    expect(all[1]).toMatchObject({ requestId: "req_123", workspaceId: "ws_abc", span: "child" });
  });

  it("child loggers inherit the redaction denylist", () => {
    const { stream, lines } = captureLogs();
    const log = createLogger({ requestId: "req_1" }, { level: "info", stream });
    log.child({ module: "documents" }).info({ password: SECRET_VALUES[0] }, "from child");
    const raw = JSON.stringify(lines());
    expect(raw).not.toContain(SECRET_VALUES[0]);
  });

  it("defaults the level from process.env.LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    const { stream, lines } = captureLogs();
    const log = createLogger({}, { stream });
    log.info("dropped");
    log.warn("kept");
    const linesOut = lines();
    expect(linesOut).toHaveLength(1);
    expect(linesOut[0]?.msg).toBe("kept");
  });
});
