// Test doubles for the ai module. Every test uses fixtures — no network, no
// API key (ANTHROPIC_API_KEY does not exist in this environment).
import { ok, type Result } from "../../bridge";
import type { AiCompletionRequest, AiProvider } from "../provider";
import type { AiUsageRepo } from "../quota";

export class FakeProvider implements AiProvider {
  readonly calls: AiCompletionRequest[] = [];
  readonly events: string[];
  private readonly queue: Array<Result<string>>;

  constructor(...responses: Array<string | Result<string>>) {
    this.queue = responses.map((r) => (typeof r === "string" ? ok(r) : r));
    this.events = [];
  }

  async complete(request: AiCompletionRequest): Promise<Result<string>> {
    this.calls.push(request);
    this.events.push("provider");
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error("FakeProvider: no more fixture responses queued");
    }
    return next;
  }
}

export class FakeUsageRepo implements AiUsageRepo {
  readonly counts = new Map<string, number>();
  readonly events: string[];

  constructor(events?: string[]) {
    this.events = events ?? [];
  }

  private key(input: { workspaceId: string; metric: string; period: string }): string {
    return `${input.workspaceId}|${input.period}|${input.metric}`;
  }

  async currentCount(input: {
    workspaceId: string;
    metric: string;
    period: string;
  }): Promise<number> {
    return this.counts.get(this.key(input)) ?? 0;
  }

  async increment(input: {
    workspaceId: string;
    metric: string;
    period: string;
  }): Promise<number> {
    this.events.push("increment");
    const next = (this.counts.get(this.key(input)) ?? 0) + 1;
    this.counts.set(this.key(input), next);
    return next;
  }
}

/** A minimal valid DocumentBody fixture (spec §7). */
export const VALID_DRAFT_JSON = {
  schemaVersion: 1,
  type: "form",
  theme: {
    tokens: { "color.bg": "#fbf9f4" },
    fontHeading: "Inter",
    fontBody: "Inter",
    radius: "md",
  },
  settings: {
    seo: {},
    locale: "en",
    progressBar: true,
    autoAdvance: true,
    showBranding: true,
    captcha: false,
    notifyEmails: [],
  },
  blocks: [
    { id: "b1", kind: "short-text", props: { label: "Your name", required: true } },
    { id: "b2", kind: "email", props: { label: "Work email", required: true } },
    { id: "b3", kind: "rating", props: { label: "How did we do?", scale: 5 } },
  ],
  endings: [{ id: "e1", title: "Thanks!" }],
  logic: { rules: [] },
} as const;

export const VALID_DRAFT_TEXT = JSON.stringify(VALID_DRAFT_JSON);
