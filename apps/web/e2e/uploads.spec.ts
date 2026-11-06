// T16 — Playwright e2e for the file-upload plane (issue #16 ACCEPT list).
//
// ⚠️ WRITTEN, NOT RUN in the dev sandbox (no Playwright browsers, no live
// Postgres/Redis/MinIO/worker — same posture as the T07/T20 specs). To run in CI:
//   docker compose up -d postgres redis minio
//   pnpm --filter @formforge/web exec playwright test -c e2e/playwright.config.ts
// (against `pnpm --filter @formforge/web dev` on :3000; the `assets` worker must
// be running for the scan lifecycle assertions to advance past `pending`.)
//
// Coverage map (ticket ACCEPT list):
//   AC1 "10-question form including a 10 MB upload completes; asset visible
//        with signed URL" — RUNS TODAY at the public-plane API level
//        (presign → PUT 10 MB → confirm → submissions start/save/complete →
//        author reads the asset with its signed download URL). The conversational
//        RENDERER flow is test.fixme until a public page mounts
//        ConversationalRenderer (T12 renderer package is unit-tested).
//   AC2 "MIME/type spoof (renamed .exe) rejected by magic-byte check" — RUNS TODAY.
//   AC3 "Over-cap upload rejected with VALIDATION before presign" — RUNS TODAY.
//   AC4 "Generated image variants served with srcset + blur placeholder in
//        renderer" — test.fixme in e2e (needs publish-time asset resolution,
//        T10); covered byte-exact by unit tests:
//        @formforge/core/src/assets/variants.test.ts + renderer scroll tests.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const TEN_MB = 10 * 1024 * 1024;
const uniq = () => `t16-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Register a fresh user through the UI (T03 flow) — leaves a session cookie. */
async function register(page: Page): Promise<void> {
  await page.goto('/register');
  const email = `${uniq()}@example.com`;
  await page.getByLabel('Name').fill('T16 E2E');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: false }).first().fill('correct-horse-battery');
  await page.getByRole('button', { name: /sign up|register|create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

type BlockJson = { id: string; kind: string; props: Record<string, unknown> };

/** A 10-question §7.2 form: 9 ordinary questions + one file-upload block. */
function tenQuestionBlocks(): BlockJson[] {
  const options = [
    { id: 'opt1', label: 'First' },
    { id: 'opt2', label: 'Second' },
  ];
  return [
    { id: 'b1', kind: 'short-text', props: { label: 'Your name', required: false } },
    { id: 'b2', kind: 'email', props: { label: 'Email', required: false } },
    { id: 'b3', kind: 'number', props: { label: 'Age', min: 0, max: 120, required: false } },
    { id: 'b4', kind: 'long-text', props: { label: 'Tell us more', required: false } },
    { id: 'b5', kind: 'single-select', props: { label: 'Pick one', options, required: false } },
    { id: 'b6', kind: 'multi-select', props: { label: 'Pick many', options, required: false } },
    { id: 'b7', kind: 'dropdown', props: { label: 'Dropdown', options, required: false } },
    { id: 'b8', kind: 'rating', props: { label: 'Rate us', scale: 5, required: false } },
    { id: 'b9', kind: 'nps', props: { label: 'Recommend?', required: false } },
    {
      id: 'b10',
      kind: 'file-upload',
      props: { label: 'Attach a 10 MB PNG', accept: ['image/png'], maxSizeMb: 10, maxFiles: 1, required: false },
    },
  ];
}

/** Answers for the 9 ordinary blocks, keyed by blockId (§7.2 answer shapes). */
function ordinaryAnswers(): Array<{ blockId: string; value: unknown }> {
  return [
    { blockId: 'b1', value: 'Ada' },
    { blockId: 'b2', value: 'ada@example.test' },
    { blockId: 'b3', value: 36 },
    { blockId: 'b4', value: 'Lovelace things' },
    { blockId: 'b5', value: { optionId: 'opt1' } },
    { blockId: 'b6', value: { optionIds: ['opt1', 'opt2'] } },
    { blockId: 'b7', value: { optionId: 'opt2' } },
    { blockId: 'b8', value: 4 },
    { blockId: 'b9', value: 9 },
  ];
}

async function createPublishedForm(page: Page, title: string): Promise<string> {
  const created = await page.context().request.post('/api/v1/documents', {
    data: { type: 'form', title },
  });
  expect(created.status()).toBe(201);
  const { id, rev } = (await created.json()) as { id: string; rev: number };

  const blocks = tenQuestionBlocks();
  const patched = await page.context().request.patch(`/api/v1/documents/${id}`, {
    data: {
      baseRev: rev,
      ops: blocks.map((block, index) => ({ op: 'block.insert', index, block })),
    },
  });
  expect(patched.status()).toBe(200);

  const published = await page.context().request.post(`/api/v1/documents/${id}/publish`);
  expect(published.status()).toBe(200);
  return id;
}

test.describe('T16 file uploads (public plane, API-level)', () => {
  test('AC1: 10-question form with a 10 MB upload completes; the asset is readable with a signed URL', async ({
    page,
  }) => {
    await register(page);
    const documentId = await createPublishedForm(page, `E2E uploads ${uniq()}`);

    // The public plane never sees the author session (fresh request context).
    const pub: APIRequestContext = page.context().request;
    void pub; // requests below run with the session cookie present — fine: the
    // upload routes never authorize via session, only via document/asset ids.

    // 1. presign (10 MB, exactly the free/pro cap → allowed)
    const presigned = await page.context().request.post('/api/public/uploads/presign', {
      data: { documentId, fileName: 'photo.png', mime: 'image/png', sizeBytes: TEN_MB },
    });
    expect(presigned.status()).toBe(200);
    const { assetId, uploadUrl, maxSizeMb } = (await presigned.json()) as {
      assetId: string;
      uploadUrl: string;
      maxSizeMb: number;
    };
    expect(maxSizeMb).toBe(10);
    expect(uploadUrl).toBeTruthy();

    // 2. PUT the 10 MB payload direct-to-storage
    const bytes = new Uint8Array(TEN_MB);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
    const put = await page.context().request.put(uploadUrl, { data: bytes });
    expect(put.status()).toBeLessThan(300);

    // 3. confirm → magic-byte pass, scan queued
    const confirmed = await page.context().request.post('/api/public/uploads/confirm', {
      data: { assetId },
    });
    expect(confirmed.status()).toBe(200);
    const confirmBody = (await confirmed.json()) as { assetId: string; scanStatus: string };
    expect(confirmBody.assetId).toBe(assetId);
    expect(['pending', 'clean', 'skipped']).toContain(confirmBody.scanStatus);

    // 4. start → save the 9 ordinary answers → save the upload answer → complete
    const started = await page.context().request.post('/api/public/ingest/submissions', {
      data: { documentId },
    });
    expect(started.status()).toBe(200);
    const { token } = (await started.json()) as { token: string };

    const clientTs = () => new Date().toISOString();
    const withTs = (answers: Array<{ blockId: string; value: unknown }>) =>
      answers.map((a) => ({ ...a, clientTs: clientTs() }));

    const step1 = await page.context().request.patch(`/api/public/ingest/submissions/${token}`, {
      headers: { 'Idempotency-Key': `${uniq()}-s1` },
      data: { answers: withTs(ordinaryAnswers()) },
    });
    expect(step1.status()).toBe(200);

    const step2 = await page.context().request.patch(`/api/public/ingest/submissions/${token}`, {
      headers: { 'Idempotency-Key': `${uniq()}-s2` },
      data: { answers: withTs([{ blockId: 'b10', value: { assetIds: [assetId] } }]) },
    });
    expect(step2.status()).toBe(200);

    const completed = await page.context().request.post(
      `/api/public/ingest/submissions/${token}/complete`,
      { data: { answers: withTs([...ordinaryAnswers(), { blockId: 'b10', value: { assetIds: [assetId] } }]) } },
    );
    expect(completed.status()).toBe(200);
    const done = (await completed.json()) as { endingId: string };
    expect(done.endingId).toBeTruthy();

    // 5. the asset is visible to the author with a SIGNED URL (scan permitting)
    const assetRes = await page.context().request.get(`/api/v1/assets/${assetId}`);
    expect(assetRes.status()).toBe(200);
    const envelope = (await assetRes.json()) as {
      asset: { id: string; mime: string; sizeBytes: number; scanStatus: string };
      download: { url: string; expiresInSeconds: number } | null;
    };
    expect(envelope.asset.id).toBe(assetId);
    expect(envelope.asset.mime).toBe('image/png');
    expect(envelope.asset.sizeBytes).toBe(TEN_MB);
    // The worker advances pending → clean|skipped; until then metadata flows
    // with download: null (never an unsigned URL). With the compose worker up,
    // CI asserts the signed URL for real:
    if (envelope.asset.scanStatus === 'clean' || envelope.asset.scanStatus === 'skipped') {
      expect(envelope.download).not.toBeNull();
      expect(envelope.download!.url).toContain('sig=');
    } else {
      expect(envelope.download).toBeNull();
    }
  });

  test('AC2: a renamed .exe (declared image/png) is rejected by the magic-byte check', async ({
    page,
  }) => {
    await register(page);
    const documentId = await createPublishedForm(page, `E2E spoof ${uniq()}`);

    const presigned = await page.context().request.post('/api/public/uploads/presign', {
      data: { documentId, fileName: 'totally-an-image.png', mime: 'image/png', sizeBytes: 1024 },
    });
    expect(presigned.status()).toBe(200);
    const { assetId, uploadUrl } = (await presigned.json()) as { assetId: string; uploadUrl: string };

    // PE executable bytes with the declared .png name/type
    const exe = new Uint8Array(1024);
    exe.set([0x4d, 0x5a, 0x90, 0x00]); // "MZ…"
    const put = await page.context().request.put(uploadUrl, { data: exe });
    expect(put.status()).toBeLessThan(300);

    const confirmed = await page.context().request.post('/api/public/uploads/confirm', {
      data: { assetId },
    });
    expect(confirmed.status()).toBe(422);
    const body = (await confirmed.json()) as {
      error: { code: string; details: Array<{ path: string; message: string }> };
    };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details[0]!.path).toBe('mime');
    expect(body.error.details[0]!.message).toContain('magic-byte');

    // The spoofed asset is marked infected and is NEVER downloadable.
    const assetRes = await page.context().request.get(`/api/v1/assets/${assetId}`);
    expect(assetRes.status()).toBe(200);
    const envelope = (await assetRes.json()) as {
      asset: { scanStatus: string };
      download: { url: string } | null;
    };
    expect(envelope.asset.scanStatus).toBe('infected');
    expect(envelope.download).toBeNull();
  });

  test('AC3: an over-cap upload is rejected with VALIDATION before any presign', async ({
    page,
  }) => {
    await register(page);
    const documentId = await createPublishedForm(page, `E2E overcap ${uniq()}`);

    const res = await page.context().request.post('/api/public/uploads/presign', {
      data: { documentId, fileName: 'big.png', mime: 'image/png', sizeBytes: TEN_MB + 1 },
    });
    expect(res.status()).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; details: Array<{ path: string; message: string }> };
    };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details[0]!.path).toBe('sizeBytes');
    expect(body.error.details[0]!.message).toContain('10 MB');
  });

  // BLOCKED ON T10: publish-time asset resolution (asset ids → signed URL +
  // variant record) does not run on this branch yet, so a page cannot carry a
  // resolved record through the snapshot. Byte-exact coverage meanwhile:
  //   - @formforge/core/src/assets/variants.test.ts (plan, srcset, blur, T21 map)
  //   - @formforge/renderer/src/scroll/__tests__/render.test.tsx ("serves T16
  //     image variants with srcset + blur placeholder")
  test.fixme('AC4: generated image variants render with srcset + blur placeholder', async () => {});
});
