// Client-side answer validation — a pragmatic mirror of the per-kind Zod rules
// (spec §7.2 answer schemas + generic props). The server remains the source of
// truth (spec §10.3: ingest validates every answer against answerSchema +
// validate()); this mirror exists purely for instant, accessible inline feedback.
// SPEC-NOTE: email/number formats use a pragmatic subset of Zod 4's rules so the
// client never rejects something the server would accept (only the reverse is
// avoided; anything the client accepts is re-validated server-side).
import { isQuestionKind, propBool, propNum, propStr, asSelectValue } from '../machine/helpers';
import type { Block } from '../../document-model';

export const MSG_REQUIRED = 'This field is required.';

export function validateAnswer(block: Block, value: unknown): string | null {
  if (!isQuestionKind(block.kind)) return null; // unsupported kinds never block the flow
  const props = block.props ?? {};
  const required = propBool(props, 'required', false);

  switch (block.kind) {
    case 'short-text':
    case 'long-text':
      return validateText(value, props, required);
    case 'email':
      return validateEmail(value, required);
    case 'number':
      return validateNumber(value, props, required);
    case 'single-select':
    case 'dropdown':
      return validateChoice(value, required);
    case 'rating':
      return validateRating(value, props, required);
    case 'nps':
      return validateNps(value, required);
    case 'file-upload':
      return validateFileUpload(value, props, required);
    default:
      return null;
  }
}

/** `{ assetIds: string[] }` — ids returned by the upload confirm endpoint. */
function assetIdsOf(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const ids = (value as { assetIds?: unknown }).assetIds;
  return Array.isArray(ids) ? ids : [];
}

// Pragmatic mirror of the @formforge/blocks file-upload rules (shape, cap,
// required). Duplicate/foreign ids stay possible client-side — the ingest
// server re-validates against the block answerSchema + validate().
function validateFileUpload(
  value: unknown,
  props: Record<string, unknown>,
  required: boolean,
): string | null {
  const ids = assetIdsOf(value);
  if (ids.some((id) => typeof id !== 'string' || id.length === 0)) {
    return 'Invalid file reference.';
  }
  const maxFiles = propNum(props, 'maxFiles');
  if (maxFiles !== undefined && ids.length > maxFiles) {
    return `Please attach at most ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`;
  }
  if (required && ids.length === 0) return MSG_REQUIRED;
  return null;
}

function isEmptyText(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

function validateText(
  value: unknown,
  props: Record<string, unknown>,
  required: boolean,
): string | null {
  if (isEmptyText(value)) return required ? MSG_REQUIRED : null;
  const maxLength = propNum(props, 'maxLength');
  if (maxLength !== undefined && (value as string).length > maxLength) {
    return `Please keep your answer to ${maxLength} characters or fewer.`;
  }
  return null;
}

// Pragmatic mirror of an email shape: local@domain.tld, no whitespace.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: unknown, required: boolean): string | null {
  if (isEmptyText(value)) return required ? MSG_REQUIRED : null;
  if (!EMAIL_RE.test(value as string)) return 'Please enter a valid email address.';
  return null;
}

function validateNumber(
  value: unknown,
  props: Record<string, unknown>,
  required: boolean,
): string | null {
  if (typeof value === 'string' && value.trim().length === 0) {
    return required ? MSG_REQUIRED : null;
  }
  if (value === null || value === undefined) return required ? MSG_REQUIRED : null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) return 'Please enter a number.';
  const min = propNum(props, 'min');
  const max = propNum(props, 'max');
  if (min !== undefined && parsed < min) {
    return max !== undefined
      ? `Please enter a number between ${min} and ${max}.`
      : `Please enter a number of at least ${min}.`;
  }
  if (max !== undefined && parsed > max) {
    return min !== undefined
      ? `Please enter a number between ${min} and ${max}.`
      : `Please enter a number of at most ${max}.`;
  }
  return null;
}

function validateChoice(value: unknown, required: boolean): string | null {
  if (!required) return null;
  const { optionId, other } = asSelectValue(value);
  if (optionId) return null;
  if (other !== undefined && other.trim().length > 0) return null;
  return 'Please choose an option.';
}

function validateRating(
  value: unknown,
  props: Record<string, unknown>,
  required: boolean,
): string | null {
  if (value === null || value === undefined || value === '') {
    return required ? 'Please pick a rating.' : null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 'Please pick a rating.';
  // scale(3–10) per spec §7.2; default 5.
  const scale = Math.min(10, Math.max(3, propNum(props, 'scale') ?? 5));
  if (parsed < 1 || parsed > scale) {
    return `Please pick a rating from 1 to ${scale}.`;
  }
  return null;
}

function validateNps(value: unknown, required: boolean): string | null {
  if (value === null || value === undefined || value === '') {
    return required ? 'Please pick a score from 0 to 10.' : null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
    return 'Please pick a score from 0 to 10.';
  }
  return null;
}

/**
 * Normalize a draft answer into the shape the ingest API expects (spec §7.2
 * "Answer value" column). Called only after validateAnswer passed, so it can
 * assume well-formed input.
 */
export function normalizeAnswer(block: Block, value: unknown): unknown {
  switch (block.kind) {
    case 'number': {
      if (value === null || value === undefined || value === '') return value;
      return typeof value === 'number' ? value : Number(String(value).trim());
    }
    case 'rating':
    case 'nps':
      return typeof value === 'number' ? value : Number(value);
    case 'short-text':
    case 'long-text':
    case 'email':
      return typeof value === 'string' ? value : '';
    case 'single-select':
    case 'dropdown':
      return asSelectValue(value);
    case 'file-upload': {
      // Answer shape { assetIds: string[] } — drop non-string entries.
      return { assetIds: assetIdsOf(value).filter((id) => typeof id === 'string' && id.length > 0) };
    }
    default:
      return value;
  }
}

/** Question label for ARIA announcements; falls back to a numbered label. */
export function questionLabel(block: Block, index: number): string {
  return propStr(block.props ?? {}, 'label') || `Question ${index + 1}`;
}
