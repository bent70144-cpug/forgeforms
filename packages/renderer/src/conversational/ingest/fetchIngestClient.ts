// Fetch-based IngestClient pointed at the public plane (spec §10.1).
//
// SPEC-NOTE: ticket #12 mentioned an `/api/public/ingest/...` prefix, but spec
// §10.1 pins the ingest routes as POST /api/public/submissions,
// PATCH /api/public/submissions/:token and POST /api/public/submissions/:token/complete.
// The spec wins; `baseUrl` is injectable so an integrator can remap every call
// with one option if the deployed gateway differs.
import {
  IngestError,
  type IngestClient,
  type IngestCompleteInput,
  type IngestCompleteResult,
  type IngestSaveInput,
  type IngestSaveResult,
  type IngestStartInput,
  type IngestStartResult,
} from './types';

export interface FetchIngestClientOptions {
  /** API origin; defaults to same-origin (''). Snapshot consumers on other origins pass it explicitly. */
  baseUrl?: string;
  /** Fetch override (tests / service workers). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export const PUBLIC_INGEST_PATHS = {
  start: '/api/public/submissions',
  save: (token: string) => `/api/public/submissions/${encodeURIComponent(token)}`,
  complete: (token: string) => `/api/public/submissions/${encodeURIComponent(token)}/complete`,
} as const;

export function createFetchIngestClient(options: FetchIngestClientOptions = {}): IngestClient {
  const baseUrl = options.baseUrl ?? '';
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(path, init);
    } catch {
      throw new IngestError(`Network error while calling ${path}`, 0);
    }
    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // body unreadable — keep generic message
      }
      throw new IngestError(
        `Ingest request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  function jsonInit(method: string, body: unknown, headers?: Record<string, string>): RequestInit {
    return {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    };
  }

  return {
    async start(input: IngestStartInput): Promise<IngestStartResult> {
      return request<IngestStartResult>(
        `${baseUrl}${PUBLIC_INGEST_PATHS.start}`,
        jsonInit('POST', {
          documentId: input.documentId,
          hidden: input.hidden ?? {},
          ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}),
          _hp: input.honeypot ?? '', // honeypot must be empty (spec §10.3)
        }),
      );
    },

    async save(token: string, input: IngestSaveInput): Promise<IngestSaveResult> {
      return request<IngestSaveResult>(
        `${baseUrl}${PUBLIC_INGEST_PATHS.save(token)}`,
        jsonInit('PATCH', { answers: input.answers }, { 'Idempotency-Key': input.idempotencyKey }),
      );
    },

    async complete(token: string, input: IngestCompleteInput): Promise<IngestCompleteResult> {
      return request<IngestCompleteResult>(
        `${baseUrl}${PUBLIC_INGEST_PATHS.complete(token)}`,
        jsonInit('POST', { answers: input.answers }),
      );
    },
  };
}
