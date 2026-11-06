// tests: Stripe signature scheme v1 (valid / tampered / replayed / malformed).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOLERANCE_SECONDS,
  signStripeEvent,
  signStripePayload,
  verifyStripeSignature,
} from './stripe/signature';

const SECRET = 'whsec_test_123';
const BODY = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
const NOW_MS = 1_700_000_000_000;

describe('verifyStripeSignature', () => {
  it('accepts a correctly signed delivery', () => {
    const header = signStripePayload(BODY, SECRET, Math.floor(NOW_MS / 1000));
    const result = verifyStripeSignature(BODY, header, SECRET, { nowMs: NOW_MS });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.timestampSeconds).toBe(Math.floor(NOW_MS / 1000));
  });

  it('rejects a tampered body (signature was computed over different bytes)', () => {
    const header = signStripePayload(BODY, SECRET, Math.floor(NOW_MS / 1000));
    const tampered = BODY.replace('evt_1', 'evt_evil');
    const result = verifyStripeSignature(tampered, header, SECRET, { nowMs: NOW_MS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
  });

  it('rejects a signature made with a different secret', () => {
    const header = signStripePayload(BODY, 'whsec_other', Math.floor(NOW_MS / 1000));
    const result = verifyStripeSignature(BODY, header, SECRET, { nowMs: NOW_MS });
    expect(result.ok).toBe(false);
  });

  it('rejects replayed deliveries outside the tolerance window', () => {
    const oldTimestamp = Math.floor(NOW_MS / 1000) - DEFAULT_TOLERANCE_SECONDS - 1;
    const header = signStripePayload(BODY, SECRET, oldTimestamp);
    const result = verifyStripeSignature(BODY, header, SECRET, { nowMs: NOW_MS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toMatch(/tolerance|replay/i);
    }
  });

  it('accepts deliveries inside the tolerance window (custom)', () => {
    const timestamp = Math.floor(NOW_MS / 1000) - 60;
    const header = signStripePayload(BODY, SECRET, timestamp);
    const result = verifyStripeSignature(BODY, header, SECRET, {
      nowMs: NOW_MS,
      toleranceSeconds: 120,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing header', () => {
    const result = verifyStripeSignature(BODY, '', SECRET, { nowMs: NOW_MS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/malformed/i);
  });

  it('rejects malformed headers', () => {
    expect(verifyStripeSignature(BODY, 'v1=deadbeef', SECRET, { nowMs: NOW_MS }).ok).toBe(false);
    expect(verifyStripeSignature(BODY, 't=notanumber,v1=deadbeef', SECRET, { nowMs: NOW_MS }).ok).toBe(
      false,
    );
    expect(verifyStripeSignature(BODY, 't=1700000000', SECRET, { nowMs: NOW_MS }).ok).toBe(false);
  });

  it('accepts any one of multiple v1 digests (Stripe rotation scheme)', () => {
    const timestamp = Math.floor(NOW_MS / 1000);
    const valid = signStripePayload(BODY, SECRET, timestamp).split('v1=')[1];
    expect(valid).toBeDefined();
    const header = `t=${timestamp},v1=0000000000000000000000000000000000000000000000000000000000000000,v1=${valid}`;
    expect(verifyStripeSignature(BODY, header, SECRET, { nowMs: NOW_MS }).ok).toBe(true);
  });

  it('negative timestamps are malformed', () => {
    const result = verifyStripeSignature(BODY, 't=-5,v1=aa', SECRET, { nowMs: NOW_MS });
    expect(result.ok).toBe(false);
  });
});

describe('signStripeEvent (test fixture helper)', () => {
  it('produces a header the verifier accepts', () => {
    const header = signStripeEvent(BODY, SECRET, NOW_MS);
    expect(header.startsWith('t=')).toBe(true);
    expect(verifyStripeSignature(BODY, header, SECRET, { nowMs: NOW_MS }).ok).toBe(true);
  });
});
