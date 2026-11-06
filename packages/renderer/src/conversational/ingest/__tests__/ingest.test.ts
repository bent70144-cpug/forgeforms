// Tests for the IngestClient seam: fetch impl against the spec §10.3 contract
// and the mock impl used by the machine tests / offline preview.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchIngestClient, PUBLIC_INGEST_PATHS } from '../fetchIngestClient';
import { createMockIngestClient } from '../mockIngestClient';
import { IngestError } from '../types';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const fetchStub = vi.fn();

afterEach(() => {
  fetchStub.mockReset();
});

describe('fetchIngestClient (spec §10.1 public plane)', () => {
  it('POSTs to /api/public/submissions on start with hidden fields and empty honeypot', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ token: 'sub_1', versionId: 'ver_1' }));
    const client = createFetchIngestClient({ fetchImpl: fetchStub as unknown as typeof fetch });
    const result = await client.start({ documentId: 'doc_1', hidden: { utm_source: 'x' } });

    expect(result).toEqual({ token: 'sub_1', versionId: 'ver_1' });
    expect(fetchStub).toHaveBeenCalledOnce();
    const [path, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/public/submissions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      documentId: 'doc_1',
      hidden: { utm_source: 'x' },
      _hp: '',
    });
  });

  it('PATCHes /api/public/submissions/:token on save with an Idempotency-Key header', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ next: 'b2', variables: {} }));
    const client = createFetchIngestClient({ fetchImpl: fetchStub as unknown as typeof fetch });
    await client.save('sub_9', {
      answers: [{ blockId: 'b1', value: 'Ana', clientTs: '2026-11-06T10:00:00.000Z' }],
      idempotencyKey: 'save-1-b1',
    });

    const [path, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/public/submissions/sub_9');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('save-1-b1');
    expect(JSON.parse(String(init.body))).toEqual({
      answers: [{ blockId: 'b1', value: 'Ana', clientTs: '2026-11-06T10:00:00.000Z' }],
    });
  });

  it('POSTs to /api/public/submissions/:token/complete on complete', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ endingId: 'end_1', redirectUrl: null }));
    const client = createFetchIngestClient({ fetchImpl: fetchStub as unknown as typeof fetch });
    const result = await client.complete('sub_9', {
      answers: [{ blockId: 'b1', value: 'Ana', clientTs: '2026-11-06T10:00:00.000Z' }],
    });

    expect(result).toEqual({ endingId: 'end_1', redirectUrl: null });
    const [path, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/public/submissions/sub_9/complete');
    expect(init.method).toBe('POST');
  });

  it('prefixes the configured baseUrl', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ token: 't', versionId: 'v' }));
    const client = createFetchIngestClient({
      fetchImpl: fetchStub as unknown as typeof fetch,
      baseUrl: 'https://api.example.com',
    });
    await client.start({ documentId: 'doc_1' });
    expect(fetchStub.mock.calls[0]?.[0]).toBe('https://api.example.com/api/public/submissions');
  });

  it('throws IngestError with the HTTP status on failure responses', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ error: 'closed' }, 410));
    const client = createFetchIngestClient({ fetchImpl: fetchStub as unknown as typeof fetch });
    await expect(client.start({ documentId: 'doc_1' })).rejects.toMatchObject({
      name: 'IngestError',
      status: 410,
    });
  });

  it('throws IngestError with status 0 on network failures', async () => {
    fetchStub.mockRejectedValueOnce(new TypeError('fetch failed'));
    const client = createFetchIngestClient({ fetchImpl: fetchStub as unknown as typeof fetch });
    await expect(client.start({ documentId: 'doc_1' })).rejects.toMatchObject({
      name: 'IngestError',
      status: 0,
    });
  });

  it('exposes the spec-pinned paths', () => {
    expect(PUBLIC_INGEST_PATHS.start).toBe('/api/public/submissions');
    expect(PUBLIC_INGEST_PATHS.save('t1')).toBe('/api/public/submissions/t1');
    expect(PUBLIC_INGEST_PATHS.complete('t1')).toBe('/api/public/submissions/t1/complete');
  });
});

describe('mockIngestClient', () => {
  it('records calls and returns configured results', async () => {
    const client = createMockIngestClient({
      token: 'sub_mock',
      versionId: 'ver_mock',
      endingId: 'end_1',
      redirectUrl: 'https://example.com/done',
    });

    await client.start({ documentId: 'doc_1' });
    await client.save('sub_mock', { answers: [], idempotencyKey: 'k1' });
    const done = await client.complete('sub_mock', { answers: [] });

    expect(client.calls.start).toHaveLength(1);
    expect(client.calls.save[0]?.token).toBe('sub_mock');
    expect(client.calls.complete[0]?.input).toEqual({ answers: [] });
    expect(done).toEqual({ endingId: 'end_1', redirectUrl: 'https://example.com/done' });

    client.reset();
    expect(client.calls.start).toHaveLength(0);
  });

  it('rejects the configured failing call', async () => {
    const client = createMockIngestClient({ failOn: 'complete' });
    await expect(client.complete('t', { answers: [] })).rejects.toBeInstanceOf(IngestError);
  });
});
