// MockIngestClient — deterministic IngestClient for tests, Storybook and
// offline preview. Records every call so unit tests can assert the exact
// payloads the renderer would send to the public plane (spec §10.3).
import type {
  IngestAnswerStep,
  IngestClient,
  IngestCompleteInput,
  IngestCompleteResult,
  IngestSaveInput,
  IngestSaveResult,
  IngestStartInput,
  IngestStartResult,
} from './types';
import { IngestError } from './types';

export interface MockIngestClientOptions {
  token?: string;
  versionId?: string;
  endingId?: string | null;
  redirectUrl?: string | null;
  /** Simulated next-block id returned from save(). */
  next?: string;
  variables?: Record<string, unknown>;
  /** When set, the given call rejects (start|save|complete). */
  failOn?: 'start' | 'save' | 'complete';
  failureMessage?: string;
  /** Artificial latency in ms (default 0). */
  delayMs?: number;
}

export interface MockIngestCalls {
  start: IngestStartInput[];
  save: Array<{ token: string; input: IngestSaveInput }>;
  complete: Array<{ token: string; input: IngestCompleteInput }>;
}

export function createMockIngestClient(options: MockIngestClientOptions = {}): IngestClient & {
  calls: MockIngestCalls;
  reset: () => void;
} {
  const calls: MockIngestCalls = { start: [], save: [], complete: [] };
  let sequence = 0;

  const wait = () =>
    options.delayMs && options.delayMs > 0
      ? new Promise<void>((resolve) => setTimeout(resolve, options.delayMs))
      : Promise.resolve();

  function failure(scope: 'start' | 'save' | 'complete'): never {
    throw new IngestError(
      options.failureMessage ?? `Mock ingest failure on ${scope}`,
      500,
    );
  }

  return {
    calls,

    reset(): void {
      calls.start.length = 0;
      calls.save.length = 0;
      calls.complete.length = 0;
      sequence = 0;
    },

    async start(input: IngestStartInput): Promise<IngestStartResult> {
      calls.start.push(input);
      await wait();
      if (options.failOn === 'start') failure('start');
      sequence += 1;
      return {
        token: options.token ?? `sub_mock_${sequence}`,
        versionId: options.versionId ?? 'ver_mock_1',
      };
    },

    async save(token: string, input: IngestSaveInput): Promise<IngestSaveResult> {
      calls.save.push({ token, input });
      await wait();
      if (options.failOn === 'save') failure('save');
      return {
        next: options.next ?? '',
        variables: options.variables ?? {},
      };
    },

    async complete(token: string, input: IngestCompleteInput): Promise<IngestCompleteResult> {
      calls.complete.push({ token, input });
      await wait();
      if (options.failOn === 'complete') failure('complete');
      return {
        endingId: options.endingId !== undefined ? options.endingId : null,
        redirectUrl: options.redirectUrl !== undefined ? options.redirectUrl : null,
      };
    },
  };
}

/** Helper for tests: the answer payload the renderer should send for a block. */
export function stepAnswer(blockId: string, value: unknown, clientTs?: string): IngestAnswerStep {
  return { blockId, value, clientTs: clientTs ?? new Date().toISOString() };
}
