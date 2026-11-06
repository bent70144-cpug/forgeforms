// Unit tests for the client-side validation mirror (spec §7.2 answer rules).
import { describe, expect, it } from 'vitest';
import { MSG_REQUIRED, normalizeAnswer, validateAnswer } from '../validateAnswer';
import { q } from '../../machine/__tests__/fixtures';

describe('validateAnswer: short-text / long-text', () => {
  const required = q('short-text', { label: 'Name', required: true, maxLength: 10 }, 'b1');
  const optional = q('long-text', { label: 'Story' }, 'b2');

  it('requires non-empty text when required', () => {
    expect(validateAnswer(required, '')).toBe(MSG_REQUIRED);
    expect(validateAnswer(required, '   ')).toBe(MSG_REQUIRED);
    expect(validateAnswer(required, undefined)).toBe(MSG_REQUIRED);
    expect(validateAnswer(required, 'Ana')).toBeNull();
  });

  it('ignores empty optional text', () => {
    expect(validateAnswer(optional, '')).toBeNull();
    expect(validateAnswer(optional, undefined)).toBeNull();
  });

  it('enforces maxLength', () => {
    expect(validateAnswer(required, 'this is way too long')).toBe(
      'Please keep your answer to 10 characters or fewer.',
    );
    expect(validateAnswer(required, '0123456789')).toBeNull();
  });
});

describe('validateAnswer: email', () => {
  const email = q('email', { label: 'Email', required: true }, 'b3');

  it('requires and validates email format', () => {
    expect(validateAnswer(email, '')).toBe(MSG_REQUIRED);
    expect(validateAnswer(email, 'nope')).toBe('Please enter a valid email address.');
    expect(validateAnswer(email, 'a b@example.com')).toBe('Please enter a valid email address.');
    expect(validateAnswer(email, 'ana@example.com')).toBeNull();
    expect(validateAnswer(email, 'ana+tag@sub.example.co')).toBeNull();
  });

  it('leaves optional empty emails alone', () => {
    const optionalEmail = q('email', { label: 'Email' }, 'b4');
    expect(validateAnswer(optionalEmail, '')).toBeNull();
    expect(validateAnswer(optionalEmail, 'nope')).toBe('Please enter a valid email address.');
  });
});

describe('validateAnswer: number', () => {
  const number = q('number', { label: 'Age', required: true, min: 0, max: 120 }, 'b5');

  it('requires a number when required', () => {
    expect(validateAnswer(number, '')).toBe(MSG_REQUIRED);
    expect(validateAnswer(number, undefined)).toBe(MSG_REQUIRED);
  });

  it('rejects non-numeric input', () => {
    expect(validateAnswer(number, 'abc')).toBe('Please enter a number.');
  });

  it('enforces min/max', () => {
    expect(validateAnswer(number, '-1')).toBe('Please enter a number between 0 and 120.');
    expect(validateAnswer(number, '121')).toBe('Please enter a number between 0 and 120.');
    expect(validateAnswer(number, '42')).toBeNull();
  });

  it('formats single-sided bounds correctly', () => {
    const minOnly = q('number', { required: true, min: 5 }, 'b6');
    const maxOnly = q('number', { required: true, max: 5 }, 'b7');
    expect(validateAnswer(minOnly, '1')).toBe('Please enter a number of at least 5.');
    expect(validateAnswer(maxOnly, '9')).toBe('Please enter a number of at most 5.');
  });

  it('accepts numeric strings with surrounding whitespace', () => {
    expect(validateAnswer(number, ' 42 ')).toBeNull();
  });
});

describe('validateAnswer: single-select / dropdown', () => {
  const select = q('single-select', { label: 'Pick', required: true, options: [{ id: 'o1', label: 'One' }] }, 'b8');
  const dropdown = q('dropdown', { label: 'Choose', required: true }, 'b9');

  it('requires a chosen option', () => {
    expect(validateAnswer(select, undefined)).toBe('Please choose an option.');
    expect(validateAnswer(select, {})).toBe('Please choose an option.');
    expect(validateAnswer(select, { optionId: '' })).toBe('Please choose an option.');
    expect(validateAnswer(dropdown, { optionId: 'o1' })).toBeNull();
  });

  it('accepts "other" text when allowOther is on', () => {
    const allowOther = q('single-select', { required: true, allowOther: true }, 'b10');
    expect(validateAnswer(allowOther, { other: 'custom' })).toBeNull();
    expect(validateAnswer(allowOther, { other: '  ' })).toBe('Please choose an option.');
  });

  it('skips optional choices', () => {
    const optional = q('single-select', { label: 'Pick' }, 'b11');
    expect(validateAnswer(optional, undefined)).toBeNull();
  });
});

describe('validateAnswer: rating', () => {
  const rating = q('rating', { label: 'Rate us', required: true, scale: 5 }, 'b12');

  it('requires a rating when required', () => {
    expect(validateAnswer(rating, undefined)).toBe('Please pick a rating.');
  });

  it('bounds the value to 1..scale', () => {
    expect(validateAnswer(rating, 0)).toBe('Please pick a rating from 1 to 5.');
    expect(validateAnswer(rating, 6)).toBe('Please pick a rating from 1 to 5.');
    expect(validateAnswer(rating, 3)).toBeNull();
  });

  it('clamps scale to the spec range 3..10', () => {
    const tiny = q('rating', { required: true, scale: 1 }, 'b13');
    const huge = q('rating', { required: true, scale: 50 }, 'b14');
    expect(validateAnswer(tiny, 5)).toBe('Please pick a rating from 1 to 3.');
    expect(validateAnswer(huge, 11)).toBe('Please pick a rating from 1 to 10.');
    expect(validateAnswer(huge, 10)).toBeNull();
  });
});

describe('validateAnswer: nps', () => {
  const nps = q('nps', { label: 'Recommend?', required: true }, 'b15');

  it('requires a score when required', () => {
    expect(validateAnswer(nps, undefined)).toBe('Please pick a score from 0 to 10.');
  });

  it('bounds the score to 0..10', () => {
    expect(validateAnswer(nps, -1)).toBe('Please pick a score from 0 to 10.');
    expect(validateAnswer(nps, 11)).toBe('Please pick a score from 0 to 10.');
    expect(validateAnswer(nps, 0)).toBeNull();
    expect(validateAnswer(nps, 10)).toBeNull();
  });
});

describe('normalizeAnswer', () => {
  it('coerces number strings to numbers', () => {
    const number = q('number', {}, 'b16');
    expect(normalizeAnswer(number, '42')).toBe(42);
    expect(normalizeAnswer(number, 7)).toBe(7);
    expect(normalizeAnswer(number, '')).toBe('');
  });

  it('keeps select shapes and text as-is', () => {
    const select = q('single-select', {}, 'b17');
    expect(normalizeAnswer(select, { optionId: 'o1' })).toEqual({ optionId: 'o1' });
    expect(normalizeAnswer(select, { other: 'hi' })).toEqual({ other: 'hi' });
    const text = q('short-text', {}, 'b18');
    expect(normalizeAnswer(text, 'hello')).toBe('hello');
  });
});
