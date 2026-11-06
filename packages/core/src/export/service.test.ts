import { describe, expect, it } from "vitest";
import type {
  ExportSubmissionRow as SubmissionRow,
  Mailer,
  SubmissionReader,
  SubmissionStreamParams,
} from "./ports";
import { CSV_BOM, CSV_EOL } from "./csv";
import { questionColumnsFromDocument, SYSTEM_COLUMN_IDS, type QuestionColumn } from "./columns";
import { InMemoryObjectStore } from "./object-store";
import {
  EXPORT_LINK_TTL_SECONDS,
  verifyExportToken,
} from "./tokens";
import {
  inDateRange,
  parseCsvExportJobPayload,
  runCsvExport,
  type CsvExportDeps,
  type ExportJobStore,
} from "./service";

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

const BASE = Date.parse("2026-11-05T10:00:00.000Z");

function fakeClock() {
  let tick = 0;
  return () => new Date(BASE + ++tick * 1000);
}

class FakeReader implements SubmissionReader {
  lastParams: SubmissionStreamParams | null = null;
  constructor(private readonly rows: SubmissionRow[]) {}
  async *streamByCursor(params: SubmissionStreamParams): AsyncIterable<SubmissionRow> {
    this.lastParams = params;
    yield* this.rows;
  }
}

class FakeMailer implements Mailer {
  readonly sent: Array<{ to: string; subject: string; text: string }> = [];
  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push({ to: message.to, subject: message.subject, text: message.text });
  }
}

type JobCall =
  | { op: "running" }
  | { op: "completed"; data: { rowCount: number; sizeBytes: number; objectKey: string; expiresAt: Date } }
  | { op: "failed"; error: string };

class FakeJobs implements ExportJobStore {
  readonly calls: JobCall[] = [];
  async markRunning(): Promise<void> {
    this.calls.push({ op: "running" });
  }
  async markCompleted(
    _exportId: string,
    _workspaceId: string,
    data: { rowCount: number; sizeBytes: number; objectKey: string; expiresAt: Date },
  ): Promise<void> {
    this.calls.push({ op: "completed", data });
  }
  async markFailed(_exportId: string, _workspaceId: string, error: string): Promise<void> {
    this.calls.push({ op: "failed", error });
  }
}

function makeDeps(rows: SubmissionRow[]) {
  const reader = new FakeReader(rows);
  const store = new InMemoryObjectStore();
  const mailer = new FakeMailer();
  const jobs = new FakeJobs();
  const now = fakeClock();
  const deps: CsvExportDeps = {
    store,
    mailer,
    submissions: reader,
    jobs,
    config: { secret: "unit-test-secret", baseUrl: "https://app.example.com" },
    now,
  };
  return { deps, reader, store, mailer, jobs };
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const QUESTION_ID = "qname00001";
const SELECT_ID = "qplan00001";
const FILE_ID = "qfile00001";

const columns: QuestionColumn[] = questionColumnsFromDocument(
  [
    { id: QUESTION_ID, kind: "short-text", props: { label: "Name" } },
    {
      id: SELECT_ID,
      kind: "single-select",
      props: { label: "Plan", options: [{ id: "opt_pro", label: "Pro Plan" }] },
    },
    { id: FILE_ID, kind: "file-upload", props: { label: "Attachments" } },
  ],
  { systemColumns: true },
);

function makeRow(overrides: Partial<SubmissionRow> & { id: string; answers?: Record<string, unknown> }): SubmissionRow {
  return {
    workspaceId: "ws-1",
    documentId: "doc-1",
    versionId: "v-1",
    status: "completed",
    answers: {},
    variables: {},
    hidden: {},
    startedAt: null,
    completedAt: new Date(BASE),
    ...overrides,
  };
}

/** Minimal RFC 4180 split for assertions (BOM stripped, CRLF records, quotes unfolded). */
function parseCsv(text: string): string[][] {
  const input = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (input.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      record.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      if (input.charAt(i + 1) === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      continue;
    }
    if (ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

// ---------------------------------------------------------------------------
// orchestration flow (rows → csv → store → email → job status)
// ---------------------------------------------------------------------------

describe("runCsvExport orchestration", () => {
  const rows = [
    makeRow({
      id: "sub-1",
      answers: { [QUESTION_ID]: "Ada, Lovelace", [SELECT_ID]: { optionId: "opt_pro" } },
    }),
    makeRow({
      id: "sub-2",
      answers: { [QUESTION_ID]: '=HYPERLINK("http://evil")', [SELECT_ID]: { other: "Enterprise" } },
    }),
    makeRow({
      id: "sub-3",
      answers: { [QUESTION_ID]: "multi\nline", [FILE_ID]: { assetIds: ["ast_1", "ast_2"] } },
    }),
  ];

  it("streams rows → csv → store → emails signed link → marks job completed", async () => {
    const { deps, store, mailer, jobs } = makeDeps(rows);

    const result = await runCsvExport(deps, {
      exportId: "018f0000-0000-7000-8000-00000000abc1",
      workspaceId: "ws-1",
      documentId: "doc-1",
      documentTitle: "Signup form",
      recipientEmail: "owner@example.com",
      columns,
    });

    // job status transitions: running → completed, never failed
    expect(jobs.calls.map((call) => call.op)).toEqual(["running", "completed"]);
    const completed = jobs.calls[1];
    expect(completed?.op).toBe("completed");
    if (completed?.op === "completed") {
      expect(completed.data.rowCount).toBe(3);
      expect(completed.data.sizeBytes).toBe(result.sizeBytes);
      expect(completed.data.objectKey).toBe(result.objectKey);
      // signed exactly on the 2nd clock tick; expires signedAt + 7 days
      expect(completed.data.expiresAt.getTime()).toBe(BASE + 2000 + EXPORT_LINK_TTL_SECONDS * 1000);
    }

    // stored CSV: stable headers, correct column ordering, escaped + sanitized cells
    const csv = store.text(result.objectKey);
    expect(csv).toBeDefined();
    expect(result.objectKey).toBe("exports/ws-1/doc-1/018f0000-0000-7000-8000-00000000abc1.csv");
    const records = parseCsv(csv!);
    expect(records[0]).toEqual([
      SYSTEM_COLUMN_IDS.submissionId,
      SYSTEM_COLUMN_IDS.submittedAt,
      SYSTEM_COLUMN_IDS.status,
      QUESTION_ID,
      SELECT_ID,
      FILE_ID,
    ]);
    expect(records[1]).toEqual(["sub-1", new Date(BASE).toISOString(), "completed", "Ada, Lovelace", "Pro Plan", ""]);
    expect(records[2]?.[3]).toBe("'=HYPERLINK(\"http://evil\")"); // formula injection neutralised
    expect(records[2]?.[4]).toBe("Enterprise"); // "other" answer
    expect(records[3]?.[3]).toBe("multi\nline"); // embedded newline survives inside quotes
    expect(records[3]?.[5]).toBe("ast_1; ast_2");

    // email: link only, no answer data
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe("owner@example.com");
    expect(mail.subject).toContain("Signup form");
    const answerValues = ["Ada, Lovelace", "Enterprise", "multi\nline", "ast_1", "Pro Plan", "=HYPERLINK"];
    for (const value of answerValues) expect(mail.text).not.toContain(value);
    expect(mail.text).toContain(result.link);

    // signed link: verifies with the configured secret and points at the stored object
    expect(result.link.startsWith("https://app.example.com/api/v1/exports/")).toBe(true);
    const verification = verifyExportToken(result.token, { secret: "unit-test-secret", now: new Date(BASE + 2000) });
    expect(verification.ok).toBe(true);
    if (verification.ok) {
      expect(verification.payload.key).toBe(result.objectKey);
      expect(verification.payload.exportId).toBe("018f0000-0000-7000-8000-00000000abc1");
    }
  });

  it("passes from/to to the reader and defensively drops rows outside the range", async () => {
    const day = (d: number) => new Date(BASE + d * 86_400_000);
    const ranged = [
      makeRow({ id: "d0", completedAt: day(0) }),
      makeRow({ id: "d1", completedAt: day(1) }),
      makeRow({ id: "d2", completedAt: day(2) }),
      makeRow({ id: "d3", completedAt: day(3) }),
      // null completedAt must be excluded whenever a range is given
      makeRow({ id: "null-completed", completedAt: null }),
    ];
    const { deps, reader, jobs } = makeDeps(ranged);
    const from = day(1);
    const to = day(2);

    const result = await runCsvExport(deps, {
      exportId: "018f0000-0000-7000-8000-00000000abc2",
      workspaceId: "ws-1",
      documentId: "doc-1",
      documentTitle: "",
      recipientEmail: "owner@example.com",
      columns,
      from,
      to,
    });

    expect(reader.lastParams?.from).toEqual(from);
    expect(reader.lastParams?.to).toEqual(to);
    expect(result.rowCount).toBe(2); // d1, d2 only
    const completed = jobs.calls[1];
    expect(completed?.op).toBe("completed");
    if (completed?.op === "completed") expect(completed.data.rowCount).toBe(2);
  });

  it("marks the job failed and sends no email when the reader throws", async () => {
    const failingReader: SubmissionReader = {
      async *streamByCursor(): AsyncIterable<SubmissionRow> {
        yield makeRow({ id: "ok-1" });
        throw new Error("cursor exploded");
      },
    };
    const { deps, mailer, jobs, store } = makeDeps([]);
    deps.submissions = failingReader;

    await expect(
      runCsvExport(deps, {
        exportId: "018f0000-0000-7000-8000-00000000abc3",
        workspaceId: "ws-1",
        documentId: "doc-1",
        documentTitle: "t",
        recipientEmail: "owner@example.com",
        columns,
      }),
    ).rejects.toThrow("cursor exploded");

    expect(jobs.calls.at(-1)?.op).toBe("failed");
    expect(jobs.calls.at(-1)).toMatchObject({ error: "cursor exploded" });
    expect(mailer.sent).toHaveLength(0);
    expect(store.has("exports/ws-1/doc-1/018f0000-0000-7000-8000-00000000abc3.csv")).toBe(false);
  });

  it("marks the job failed when the mailer throws (no partial success email state)", async () => {
    const { deps, jobs } = makeDeps([makeRow({ id: "sub-9" })]);
    deps.mailer = {
      send: async () => {
        throw new Error("smtp down");
      },
    };

    await expect(
      runCsvExport(deps, {
        exportId: "018f0000-0000-7000-8000-00000000abc4",
        workspaceId: "ws-1",
        documentId: "doc-1",
        documentTitle: "t",
        recipientEmail: "owner@example.com",
        columns,
      }),
    ).rejects.toThrow("smtp down");

    expect(jobs.calls.map((call) => call.op)).toEqual(["running", "failed"]);
  });

  it("rejects invalid from/to dates up front", async () => {
    const { deps, jobs } = makeDeps([]);
    await expect(
      runCsvExport(deps, {
        exportId: "018f0000-0000-7000-8000-00000000abc5",
        workspaceId: "ws-1",
        documentId: "doc-1",
        documentTitle: "t",
        recipientEmail: "owner@example.com",
        columns,
        from: "not-a-date",
      }),
    ).rejects.toThrow("invalid from date");
    expect(jobs.calls).toEqual([]); // validation precedes any job mutation
  });
});

describe("inDateRange", () => {
  const t = (iso: string) => new Date(iso);
  it("is inclusive on both bounds", () => {
    const from = t("2026-01-01T00:00:00.000Z");
    const to = t("2026-01-31T23:59:59.000Z");
    expect(inDateRange(from, from, to)).toBe(true);
    expect(inDateRange(to, from, to)).toBe(true);
    expect(inDateRange(t("2025-12-31T23:59:59.000Z"), from, to)).toBe(false);
    expect(inDateRange(t("2026-02-01T00:00:00.000Z"), from, to)).toBe(false);
  });

  it("accepts ISO strings and drops unparseable/null values when a range is set", () => {
    expect(inDateRange("2026-01-15T00:00:00.000Z", t("2026-01-01T00:00:00.000Z"), t("2026-02-01T00:00:00.000Z"))).toBe(true);
    expect(inDateRange("garbage", t("2026-01-01T00:00:00.000Z"))).toBe(false);
    expect(inDateRange(null, t("2026-01-01T00:00:00.000Z"))).toBe(false);
    expect(inDateRange(null)).toBe(true); // no range → everything passes
  });
});

describe("parseCsvExportJobPayload", () => {
  const validPayload = {
    exportId: "018f0000-0000-7000-8000-00000000abc6",
    workspaceId: "018f0000-0000-7000-8000-00000000a001",
    documentId: "018f0000-0000-7000-8000-00000000b002",
    documentTitle: "Signup",
    recipientEmail: "owner@example.com",
    columns: [{ id: "q1", header: "q1" }],
    from: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a valid payload", () => {
    const payload = parseCsvExportJobPayload(validPayload);
    expect(payload.documentTitle).toBe("Signup");
    expect(payload.columns).toHaveLength(1);
  });

  it("defaults documentTitle to empty string", () => {
    const { documentTitle, ...rest } = validPayload as Record<string, unknown>;
    void documentTitle;
    const payload = parseCsvExportJobPayload(rest);
    expect(payload.documentTitle).toBe("");
  });

  it.each([
    ["missing exportId", { ...validPayload, exportId: undefined }],
    ["bad uuid", { ...validPayload, workspaceId: "ws" }],
    ["bad email", { ...validPayload, recipientEmail: "nope" }],
    ["empty columns", { ...validPayload, columns: [] }],
    ["non-ISO from", { ...validPayload, from: "yesterday" }],
  ])("rejects %s", (_label, payload) => {
    expect(() => parseCsvExportJobPayload(payload)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// acceptance: 10k-row export completes well under the 5-minute budget
// (spec §18: "CSV export (10k rows) < 5 min") with correct column ordering.
// ----------------------------------------------------------------------------

describe("runCsvExport — 10k rows (issue #18 acceptance)", () => {
  it("exports 10k rows with correct column ordering, quickly", async () => {
    const rowCount = 10_000;
    const bigRows: SubmissionRow[] = Array.from({ length: rowCount }, (_, index) =>
      makeRow({
        id: `sub-${index}`,
        completedAt: new Date(BASE + index * 1000),
        answers: {
          [QUESTION_ID]: index % 3 === 0 ? `name, with comma #${index}` : `name ${index}`,
          [SELECT_ID]: index % 2 === 0 ? { optionId: "opt_pro" } : { other: "Other, plan" },
        },
      }),
    );
    const { deps, jobs, store } = makeDeps(bigRows);

    const started = Date.now();
    const result = await runCsvExport(deps, {
      exportId: "018f0000-0000-7000-8000-00000000ab10",
      workspaceId: "ws-1",
      documentId: "doc-1",
      documentTitle: "10k fixture",
      recipientEmail: "owner@example.com",
      columns,
    });
    const elapsedMs = Date.now() - started;

    expect(result.rowCount).toBe(rowCount);
    const completed = jobs.calls[1];
    expect(completed?.op).toBe("completed");
    if (completed?.op === "completed") expect(completed.data.rowCount).toBe(rowCount);

    // header + 10k data rows; column order stable
    const csv = store.text(result.objectKey)!;
    const lines = csv.split(CSV_EOL).filter((line) => line.length > 0);
    expect(lines).toHaveLength(rowCount + 1);
    expect(lines[0]).toBe(
      `${CSV_BOM}${SYSTEM_COLUMN_IDS.submissionId},${SYSTEM_COLUMN_IDS.submittedAt},${SYSTEM_COLUMN_IDS.status},${QUESTION_ID},${SELECT_ID},${FILE_ID}`,
    );
    expect(lines[1]).toContain(`sub-0,${new Date(BASE).toISOString()},completed,"name, with comma #0",Pro Plan,`);
    expect(lines[rowCount]).toContain(`sub-${rowCount - 1}`);

    // AC is < 5 min on CI hardware; the pure builder does this in well under a
    // second locally — 60 s gives ~1000x headroom for slow CI runners.
    expect(elapsedMs).toBeLessThan(60_000);
  }, 120_000);
});
