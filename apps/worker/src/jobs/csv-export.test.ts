import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ExportSubmissionRow as SubmissionRow, Mailer, SubmissionReader } from "@formforge/core/export";
import { InMemoryObjectStore, questionColumnsFromDocument } from "@formforge/core/export";
import type { CsvExportDeps, ExportJobStore } from "@formforge/core/export";
import {
  CSV_EXPORT_JOB,
  EXPORTS_QUEUE,
  createCsvExportJobHandler,
  csvExportJobOptions,
} from "./csv-export";

const reader: SubmissionReader = {
  async *streamByCursor(): AsyncIterable<SubmissionRow> {
    yield {
      id: "sub-1",
      workspaceId: "018f0000-0000-7000-8000-000000000001",
      documentId: "018f0000-0000-7000-8000-000000000002",
      versionId: "v1",
      status: "completed",
      answers: { q1: "hello" },
      variables: {},
      hidden: {},
      startedAt: null,
      completedAt: new Date("2026-11-05T10:00:00.000Z"),
    };
  },
};

class RecordingMailer implements Mailer {
  readonly sent: Array<{ to: string; subject: string; text: string }> = [];
  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push(message);
  }
}

class RecordingJobs implements ExportJobStore {
  readonly ops: string[] = [];
  async markRunning(): Promise<void> {
    this.ops.push("running");
  }
  async markCompleted(): Promise<void> {
    this.ops.push("completed");
  }
  async markFailed(): Promise<void> {
    this.ops.push("failed");
  }
}

function makeDeps(): { deps: CsvExportDeps; mailer: RecordingMailer; store: InMemoryObjectStore; jobs: RecordingJobs } {
  const mailer = new RecordingMailer();
  const store = new InMemoryObjectStore();
  const jobs = new RecordingJobs();
  return {
    deps: {
      store,
      mailer,
      submissions: reader,
      jobs,
      config: { secret: "worker-test-secret", baseUrl: "https://app.example.com" },
      now: () => new Date("2026-11-05T11:00:00.000Z"),
    },
    mailer,
    store,
    jobs,
  };
}

describe("csv-export job (spec §12 exports queue)", () => {
  it("exposes the queue/job names from spec §12", () => {
    expect(EXPORTS_QUEUE).toBe("exports");
    expect(CSV_EXPORT_JOB).toBe("csv-export");
  });

  it("dedupes retries on the exportId via jobId options", () => {
    const options = csvExportJobOptions("018f0000-0000-7000-8000-00000000ex01");
    expect(options.jobId).toBe("018f0000-0000-7000-8000-00000000ex01");
    expect(options.attempts).toBeGreaterThan(0);
    expect(options.removeOnFail).toBe(false);
  });

  it("processes a valid BullMQ job end-to-end", async () => {
    const { deps, mailer, store, jobs } = makeDeps();
    const handler = createCsvExportJobHandler(deps);
    const exportId = randomUUID();

    await handler({
      id: "bullmq-job-1",
      data: {
        exportId,
        workspaceId: "018f0000-0000-7000-8000-000000000001",
        documentId: "018f0000-0000-7000-8000-000000000002",
        documentTitle: "Contact form",
        recipientEmail: "owner@example.com",
        columns: questionColumnsFromDocument([{ id: "q1", kind: "short-text", props: { label: "Q1" } }]),
      },
    });

    expect(jobs.ops).toEqual(["running", "completed"]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("owner@example.com");
    expect(store.has(`exports/018f0000-0000-7000-8000-000000000001/018f0000-0000-7000-8000-000000000002/${exportId}.csv`)).toBe(true);
  });

  it("rejects malformed job payloads (Zod) without touching dependencies", async () => {
    const { deps, mailer, jobs } = makeDeps();
    const handler = createCsvExportJobHandler(deps);

    await expect(handler({ id: "bad", data: { exportId: "nope" } })).rejects.toThrow();
    expect(mailer.sent).toHaveLength(0);
    expect(jobs.ops).toEqual([]);
  });
});
