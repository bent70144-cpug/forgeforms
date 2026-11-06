// T07 — unit tests for the dashboard display helpers (pure, no DOM).
import { describe, expect, it } from 'vitest';
import {
  documentStatusBadge,
  documentStatusTone,
  documentTypeBadge,
  publicShareUrl,
  relativeUpdatedAt,
} from './format';

describe('documentTypeBadge', () => {
  it('labels all three §6 types', () => {
    expect(documentTypeBadge('form')).toBe('Form');
    expect(documentTypeBadge('page')).toBe('Page');
    expect(documentTypeBadge('portfolio')).toBe('Portfolio');
  });
});

describe('documentStatusBadge + tone', () => {
  it('labels the lifecycle statuses (spec §6)', () => {
    expect(documentStatusBadge('draft')).toBe('Draft');
    expect(documentStatusBadge('published')).toBe('Published');
    expect(documentStatusBadge('archived')).toBe('Archived');
    expect(documentStatusTone('draft')).toBe('neutral');
    expect(documentStatusTone('published')).toBe('positive');
    expect(documentStatusTone('archived')).toBe('muted');
  });
});

describe('relativeUpdatedAt (deterministic given now)', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  it('renders relative buckets', () => {
    expect(relativeUpdatedAt('2026-11-06T11:59:40Z', now)).toBe('just now');
    expect(relativeUpdatedAt('2026-11-06T11:35:00Z', now)).toBe('25 min ago');
    expect(relativeUpdatedAt('2026-11-06T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeUpdatedAt('2026-11-04T12:00:00Z', now)).toBe('2 d ago');
  });
  it('falls back to a date beyond a week and to — for junk', () => {
    expect(relativeUpdatedAt('2026-10-01T00:00:00Z', now)).toContain('2026');
    expect(relativeUpdatedAt('not-a-date', now)).toBe('—');
  });
});

describe('publicShareUrl', () => {
  it('builds the §10 public URL and encodes the slug', () => {
    expect(publicShareUrl('http://localhost:3000', 'contact-form')).toBe(
      'http://localhost:3000/p/contact-form',
    );
    expect(publicShareUrl('http://localhost:3000/', 'a b')).toBe('http://localhost:3000/p/a%20b');
  });
});
