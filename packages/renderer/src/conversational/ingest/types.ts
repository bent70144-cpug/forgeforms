// IngestClient — the transport seam between the conversational renderer and the
// public ingest API (spec §10.3). The renderer never talks to the network
// directly; tests inject MockIngestClient, production uses FetchIngestClient.
export interface IngestStartInput {
  documentId: string;
  /** Hidden field values (UTM capture etc.). */
  hidden?: Record<string, unknown>;
  /** Turnstile token when the document has captcha enabled (Phase 2 wiring). */
  turnstileToken?: string;
  /** Honeypot value — must stay empty for humans (spec §10.3 limits). */
  honeypot?: string;
}

export interface IngestStartResult {
  token: string;
  versionId: string;
}

export interface IngestAnswerStep {
  blockId: string;
  value: unknown;
  clientTs: string;
}

export interface IngestSaveInput {
  answers: IngestAnswerStep[];
  /** Sent as the Idempotency-Key header (spec §10.3). */
  idempotencyKey: string;
}

export interface IngestSaveResult {
  next: string;
  variables: Record<string, unknown>;
}

export interface IngestCompleteInput {
  /** The client's final value for every touched block (spec §10.3). */
  answers: IngestAnswerStep[];
}

export interface IngestCompleteResult {
  endingId: string | null;
  redirectUrl: string | null;
}

export interface IngestClient {
  start(input: IngestStartInput): Promise<IngestStartResult>;
  save(token: string, input: IngestSaveInput): Promise<IngestSaveResult>;
  complete(token: string, input: IngestCompleteInput): Promise<IngestCompleteResult>;
}

export class IngestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'IngestError';
    this.status = status;
  }
}
