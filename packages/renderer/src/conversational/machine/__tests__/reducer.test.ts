// Unit tests for the conversational renderer state machine (issue #12).
// Covers: navigation (next/back), validation gates, logic jumps (goto/set/end),
// auto-advance helpers, submit success/failure/retry, welcome/ending handling.
import { describe, expect, it } from 'vitest';
import { MSG_REQUIRED, validateAnswer } from '../../validation/validateAnswer';
import { isInstantAnswer, isQuestionKind, resolveEnding } from '../helpers';
import { createInitialState, createMachineReducer } from '../reducer';
import type { MachineEvent, MachineState } from '../types';
import { basicDoc, formDoc, machineDocOf, q, rule } from './fixtures';

function boot(doc = basicDoc(), hidden: Record<string, unknown> = {}) {
  const machineDoc = machineDocOf(doc);
  const reducer = createMachineReducer(machineDoc);
  const initial = createInitialState(machineDoc, hidden);
  return { machineDoc, reducer, initial };
}

function run(
  reducer: ReturnType<typeof createMachineReducer>,
  state: MachineState,
  ...events: MachineEvent[]
): MachineState {
  let current = state;
  for (const event of events) current = reducer(current, event);
  return current;
}

function answerFor(state: MachineState, blockId: string): unknown {
  return state.answers[blockId];
}

describe('machine: initial state', () => {
  it('starts on the welcome screen when the document configures one', () => {
    const doc = formDoc({
      blocks: [q('short-text', { label: 'Name' }, 'b1')],
      welcome: { enabled: true, title: 'Hi!', buttonText: 'Begin' },
    });
    const { machineDoc, initial } = boot(doc);
    expect(machineDoc.hasWelcome).toBe(true);
    expect(initial.phase).toBe('idle');
  });

  it('skips the welcome screen when none is configured', () => {
    const { initial } = boot(basicDoc());
    expect(initial.phase).toBe('question');
    expect(initial.index).toBe(0);
  });

  it('lands directly on done for a form with no question blocks', () => {
    const { initial } = boot(formDoc({ endings: [{ id: 'end_x', title: 'Bye' }] }));
    expect(initial.phase).toBe('done');
    expect(initial.ending?.id).toBe('end_x');
  });

  it('uses a built-in ending when the document has none', () => {
    const { initial } = boot(formDoc({}));
    expect(initial.phase).toBe('done');
    expect(initial.ending?.id).toBe('default');
    expect(initial.ending?.title).toContain('Thanks');
  });

  it('records hidden field values for the ingest start call', () => {
    const { initial } = boot(basicDoc(), { utm_source: 'newsletter' });
    expect(initial.hidden).toEqual({ utm_source: 'newsletter' });
  });
});

describe('machine: navigation', () => {
  it('START moves idle → question[0]', () => {
    const doc = formDoc({
      blocks: [q('short-text', {}, 'b1')],
      welcome: { enabled: true },
    });
    const { reducer, initial } = boot(doc);
    const next = run(reducer, initial, { type: 'START' });
    expect(next.phase).toBe('question');
    expect(next.index).toBe(0);
  });

  it('valid answer advances to the next question and commits', () => {
    const { reducer, initial } = boot();
    const next = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 'Ana' }, { type: 'NEXT' });
    expect(next.phase).toBe('question');
    expect(next.index).toBe(1);
    expect(next.committed['b1']?.value).toBe('Ana');
    expect(next.lastCommitted?.blockId).toBe('b1');
    expect(next.lastCommitted?.seq).toBe(1);
  });

  it('invalid required answer stays on the question and records the error', () => {
    const { reducer, initial } = boot();
    const next = run(reducer, initial, { type: 'NEXT' });
    expect(next.phase).toBe('question');
    expect(next.index).toBe(0);
    expect(next.errors['b1']).toBe(MSG_REQUIRED);
    expect(next.committed['b1']).toBeUndefined();
    expect(next.lastCommitted).toBeNull();
  });

  it('optional questions pass the gate when empty', () => {
    const doc = formDoc({
      blocks: [q('short-text', { label: 'Nickname' }, 'b1'), q('nps', { label: 'NPS' }, 'b2')],
    });
    const { reducer, initial } = boot(doc);
    const next = run(reducer, initial, { type: 'NEXT' });
    expect(next.phase).toBe('question');
    expect(next.index).toBe(1);
  });

  it('clears a question error as soon as a new answer arrives', () => {
    const { reducer, initial } = boot();
    const errored = run(reducer, initial, { type: 'NEXT' });
    expect(errored.errors['b1']).toBeDefined();
    const fixed = reducer(errored, { type: 'ANSWER', blockId: 'b1', value: 'Ana' });
    expect(fixed.errors['b1']).toBeUndefined();
  });

  it('BACK steps to the previous question and keeps the draft answer', () => {
    const { reducer, initial } = boot();
    const onQ2 = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 'Ana' }, { type: 'NEXT' });
    const back = reducer(onQ2, { type: 'BACK' });
    expect(back.phase).toBe('question');
    expect(back.index).toBe(0);
    expect(answerFor(back, 'b1')).toBe('Ana');
    // And re-answering + advancing works (re-commit overwrites).
    const again = run(
      reducer,
      back,
      { type: 'ANSWER', blockId: 'b1', value: 'Anna' },
      { type: 'NEXT' },
    );
    expect(again.index).toBe(1);
    expect(again.committed['b1']?.value).toBe('Anna');
    expect(again.lastCommitted?.seq).toBe(2);
  });

  it('BACK from the first question returns to the welcome screen when present', () => {
    const doc = formDoc({
      blocks: [q('short-text', {}, 'b1')],
      welcome: { enabled: true },
    });
    const { reducer, initial } = boot(doc);
    const onQ1 = run(reducer, initial, { type: 'START' });
    const back = reducer(onQ1, { type: 'BACK' });
    expect(back.phase).toBe('idle');
  });

  it('BACK on the first question without a welcome screen is a no-op', () => {
    const { reducer, initial } = boot();
    const back = reducer(initial, { type: 'BACK' });
    expect(back).toBe(initial);
  });

  it('ignores NEXT/START in unrelated phases and ANSWER outside question', () => {
    const { reducer, initial } = boot();
    // ANSWER is legal only in the question phase:
    const validating: MachineState = { ...initial, phase: 'validating' };
    expect(reducer(validating, { type: 'ANSWER', blockId: 'b1', value: 'x' })).toBe(validating);
    expect(reducer(validating, { type: 'START' })).toBe(validating);
    const done: MachineState = {
      ...initial,
      phase: 'done',
      ending: { id: 'end_1', title: 't', body: null, redirectUrl: null },
    };
    expect(reducer(done, { type: 'NEXT' })).toBe(done);
    expect(reducer(done, { type: 'ANSWER', blockId: 'b1', value: 'x' })).toBe(done);
    // ANSWER in question phase is legal (draft edits):
    expect(reducer(initial, { type: 'ANSWER', blockId: 'b1', value: 'x' }).answers['b1']).toBe('x');
  });
});

describe('machine: validation gates per kind', () => {
  it('blocks an invalid email and lets a valid one through', () => {
    const { reducer, initial } = boot();
    const onQ2 = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 'Ana' }, { type: 'NEXT' });
    const bad = run(reducer, onQ2, { type: 'ANSWER', blockId: 'b2', value: 'not-an-email' }, { type: 'NEXT' });
    expect(bad.phase).toBe('question');
    expect(bad.errors['b2']).toBe('Please enter a valid email address.');
    const good = run(reducer, bad, { type: 'ANSWER', blockId: 'b2', value: 'ana@example.com' }, { type: 'NEXT' });
    expect(good.phase).toBe('question');
    expect(good.index).toBe(2);
    expect(good.errors['b2']).toBeUndefined();
  });

  it('blocks a single-select without a choice when required', () => {
    const doc = formDoc({ blocks: [q('single-select', { label: 'Pick', required: true, options: [{ id: 'o1', label: 'One' }] }, 'b1')] });
    const { reducer, initial } = boot(doc);
    const blocked = run(reducer, initial, { type: 'NEXT' });
    expect(blocked.errors['b1']).toBe('Please choose an option.');
    const ok = run(reducer, blocked, { type: 'ANSWER', blockId: 'b1', value: { optionId: 'o1' } }, { type: 'NEXT' });
    expect(ok.phase).toBe('validating');
    expect(ok.committed['b1']?.value).toEqual({ optionId: 'o1' });
  });

  it('accepts the "Other" free text for single-select', () => {
    const doc = formDoc({ blocks: [q('single-select', { label: 'Pick', required: true, allowOther: true, options: [{ id: 'o1', label: 'One' }] }, 'b1')] });
    const { reducer, initial } = boot(doc);
    const ok = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: { other: 'Something else' } }, { type: 'NEXT' });
    expect(ok.errors['b1']).toBeUndefined();
  });

  it('normalizes number answers to numeric values on commit', () => {
    const doc = formDoc({ blocks: [q('number', { label: 'Age', required: true }, 'b1')] });
    const { reducer, initial } = boot(doc);
    const next = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: '42' }, { type: 'NEXT' });
    expect(next.committed['b1']?.value).toBe(42);
  });

  it('enforces number min/max props', () => {
    const doc = formDoc({ blocks: [q('number', { label: 'Age', required: true, min: 18, max: 99 }, 'b1')] });
    const { reducer, initial } = boot(doc);
    const under = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: '5' }, { type: 'NEXT' });
    expect(under.errors['b1']).toBe('Please enter a number between 18 and 99.');
    const over = run(reducer, under, { type: 'ANSWER', blockId: 'b1', value: '120' }, { type: 'NEXT' });
    expect(over.errors['b1']).toBe('Please enter a number between 18 and 99.');
  });

  it('rejects out-of-range rating values', () => {
    const doc = formDoc({ blocks: [q('rating', { label: 'Rate', required: true, scale: 5 }, 'b1')] });
    const { reducer, initial } = boot(doc);
    const bad = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 9 }, { type: 'NEXT' });
    expect(bad.errors['b1']).toBe('Please pick a rating from 1 to 5.');
    const ok = run(reducer, bad, { type: 'ANSWER', blockId: 'b1', value: 4 }, { type: 'NEXT' });
    expect(ok.phase).toBe('validating');
  });
});

describe('machine: logic-driven navigation (spec §9 semantics)', () => {
  it('jumps to the goto target block', () => {
    const doc = formDoc({
      blocks: [
        q('nps', { label: 'Score', required: true }, 'b1'),
        q('short-text', { label: 'Skipped' }, 'b2'),
        q('short-text', { label: 'Follow-up' }, 'b3'),
      ],
      rules: [rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'lte', right: 6 }], then: [{ type: 'goto', target: 'b3' }] })],
    });
    const { reducer, initial } = boot(doc);
    const next = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 3 }, { type: 'NEXT' });
    expect(next.index).toBe(2); // b3
    const otherPath = run(
      reducer,
      initial,
      { type: 'ANSWER', blockId: 'b1', value: 9 },
      { type: 'NEXT' },
    );
    expect(otherPath.index).toBe(1); // default next → b2
  });

  it('follows goto end:<endingId> straight into validating', () => {
    const doc = formDoc({
      blocks: [q('nps', { label: 'Score', required: true }, 'b1'), q('short-text', {}, 'b2')],
      endings: [
        { id: 'end_bad', title: 'Sorry to hear' },
        { id: 'end_good', title: 'Thank you!' },
      ],
      rules: [rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'lte', right: 6 }], then: [{ type: 'goto', target: 'end:end_bad' }] })],
    });
    const { reducer, initial } = boot(doc);
    const next = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 4 }, { type: 'NEXT' });
    expect(next.phase).toBe('validating');
    expect(next.pendingEndingId).toBe('end_bad');
  });

  it('applies set actions to the variables map', () => {
    const doc = formDoc({
      blocks: [q('short-text', { label: 'Name' }, 'b1')],
      rules: [rule({ scope: 'b1', when: [], then: [{ type: 'set', var: 'greeted', value: true }] })],
    });
    const { reducer, initial } = boot(doc);
    const next = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 'Ana' }, { type: 'NEXT' });
    expect(next.variables['greeted']).toBe(true);
  });

  it('falls back to default next when the goto target is unknown', () => {
    const doc = formDoc({
      blocks: [q('short-text', {}, 'b1'), q('nps', {}, 'b2')],
      rules: [rule({ scope: 'b1', when: [], then: [{ type: 'goto', target: 'b_missing' }] })],
    });
    const { reducer, initial } = boot(doc);
    const next = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 'x' }, { type: 'NEXT' });
    expect(next.index).toBe(1);
  });

  it('runs the fallback rule only when no other rule matched', () => {
    const doc = formDoc({
      blocks: [q('nps', { label: 'Score' }, 'b1'), q('short-text', {}, 'b2'), q('short-text', {}, 'b3')],
      rules: [
        rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'gte', right: 9 }], then: [{ type: 'goto', target: 'b3' }] }),
        rule({ scope: 'b1', isFallback: true, then: [{ type: 'goto', target: 'b2' }] }),
      ],
    });
    const { reducer, initial } = boot(doc);
    const hit = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 10 }, { type: 'NEXT' });
    expect(hit.index).toBe(2);
    const fallback = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 3 }, { type: 'NEXT' });
    expect(fallback.index).toBe(1);
  });

  it('hidden question blocks are excluded from the flow entirely', () => {
    const doc = formDoc({
      blocks: [
        q('short-text', { label: 'A' }, 'b1'),
        { id: 'b_hidden', kind: 'short-text', props: { label: 'H' }, hidden: true },
        q('nps', { label: 'B' }, 'b2'),
      ],
    });
    const { machineDoc, reducer, initial } = boot(doc);
    expect(machineDoc.questions.map((block) => block.id)).toEqual(['b1', 'b2']);
    const next = run(reducer, initial, { type: 'ANSWER', blockId: 'b1', value: 'x' }, { type: 'NEXT' });
    expect(next.index).toBe(1);
    expect(machineDoc.questions[next.index]?.id).toBe('b2');
  });
});

describe('machine: submit pipeline', () => {
  function atValidating() {
    const { machineDoc, reducer, initial } = boot();
    const validating = run(
      reducer,
      initial,
      { type: 'ANSWER', blockId: 'b1', value: 'Ana' },
      { type: 'NEXT' },
      { type: 'ANSWER', blockId: 'b2', value: 'ana@example.com' },
      { type: 'NEXT' },
      { type: 'ANSWER', blockId: 'b3', value: 9 },
      { type: 'NEXT' },
    );
    return { machineDoc, reducer, initial, validating };
  }

  it('the last valid answer enters validating and carries every committed answer', () => {
    const { validating } = atValidating();
    expect(validating.phase).toBe('validating');
    expect(Object.keys(validating.committed).sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('SUBMIT moves validating → submitting (and only from validating)', () => {
    const { reducer, validating } = atValidating();
    const submitting = reducer(validating, { type: 'SUBMIT' });
    expect(submitting.phase).toBe('submitting');
    expect(submitting.submitSeq).toBe(1);
    expect(reducer(validating, { type: 'SUBMIT_FAILURE', message: 'nope' })).toBe(validating);
  });

  it('SUBMIT_SUCCESS resolves the server ending and stores the token', () => {
    const { reducer, validating } = atValidating();
    const done = run(
      reducer,
      validating,
      { type: 'SUBMIT' },
      { type: 'SUBMIT_SUCCESS', token: 'sub_1', endingId: null, redirectUrl: null },
    );
    expect(done.phase).toBe('done');
    expect(done.submissionToken).toBe('sub_1');
    expect(done.ending?.id).toBe('end_1'); // first configured ending
    expect(done.ending?.title).toBe('Thanks!');
  });

  it('SUBMIT_SUCCESS prefers the logic-resolved ending when the server omits one', () => {
    const doc = formDoc({
      blocks: [q('nps', { label: 'Score', required: true }, 'b1')],
      endings: [{ id: 'end_a', title: 'A' }, { id: 'end_b', title: 'B' }],
      rules: [rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'lte', right: 6 }], then: [{ type: 'goto', target: 'end:end_b' }] })],
    });
    const { reducer, initial } = boot(doc);
    const done = run(
      reducer,
      initial,
      { type: 'ANSWER', blockId: 'b1', value: 3 },
      { type: 'NEXT' },
      { type: 'SUBMIT' },
      { type: 'SUBMIT_SUCCESS', token: 'sub_2', endingId: null, redirectUrl: null },
    );
    expect(done.ending?.id).toBe('end_b');
  });

  it('SUBMIT_SUCCESS follows the server redirectUrl even when the ending has none', () => {
    const { reducer, validating } = atValidating();
    const done = run(
      reducer,
      validating,
      { type: 'SUBMIT' },
      { type: 'SUBMIT_SUCCESS', token: 'sub_3', endingId: 'end_1', redirectUrl: 'https://example.com/next' },
    );
    expect(done.phase).toBe('done');
    expect(done.ending?.redirectUrl).toBe('https://example.com/next');
  });

  it('SUBMIT_FAILURE lands in error; RETRY re-enters submitting; BACK resumes the last question', () => {
    const { reducer, validating } = atValidating();
    const submitting = run(reducer, validating, { type: 'SUBMIT' });
    const failed = reducer(submitting, { type: 'SUBMIT_FAILURE', message: 'boom' });
    expect(failed.phase).toBe('error');
    expect(failed.message).toBe('boom');
    expect(failed.attempts).toBe(1);
    const retrying = reducer(failed, { type: 'RETRY' });
    expect(retrying.phase).toBe('submitting');
    expect(retrying.submitSeq).toBe(submitting.submitSeq + 1);
    expect(retrying.message).toBeNull();
    // Back out of the error screen instead:
    const backToQuestions = reducer(failed, { type: 'BACK' });
    expect(backToQuestions.phase).toBe('question');
    expect(backToQuestions.index).toBe(2); // last question
  });

  it('SUBMIT_SUCCESS is ignored outside the submitting phase', () => {
    const { reducer, validating } = atValidating();
    const same = reducer(validating, {
      type: 'SUBMIT_SUCCESS',
      token: 'sub_x',
      endingId: null,
      redirectUrl: null,
    });
    expect(same).toBe(validating);
  });
});

describe('machine: helpers', () => {
  it('isInstantAnswer flags exactly the auto-advance kinds', () => {
    expect(isInstantAnswer('single-select')).toBe(true);
    expect(isInstantAnswer('dropdown')).toBe(true);
    expect(isInstantAnswer('rating')).toBe(true);
    expect(isInstantAnswer('nps')).toBe(true);
    expect(isInstantAnswer('short-text')).toBe(false);
    expect(isInstantAnswer('long-text')).toBe(false);
    expect(isInstantAnswer('email')).toBe(false);
    expect(isInstantAnswer('number')).toBe(false);
  });

  it('isQuestionKind covers the supported question kinds and nothing else', () => {
    for (const kind of ['short-text', 'long-text', 'email', 'number', 'single-select', 'dropdown', 'rating', 'nps']) {
      expect(isQuestionKind(kind)).toBe(true);
    }
    expect(isQuestionKind('multi-select')).toBe(false);
    expect(isQuestionKind('hero')).toBe(false);
    expect(isQuestionKind('')).toBe(false);
  });

  it('resolveEnding falls back gracefully', () => {
    const endings = [{ id: 'end_1', title: 'One', redirectUrl: 'https://example.com' }];
    expect(resolveEnding(endings, 'end_1')?.redirectUrl).toBe('https://example.com');
    expect(resolveEnding(endings, 'missing')?.id).toBe('end_1'); // first wins
    expect(resolveEnding([], null)).toEqual({
      id: 'default',
      title: 'Thanks for your response!',
      body: null,
      redirectUrl: null,
    });
  });

  it('validateAnswer passes unsupported kinds through (never blocks)', () => {
    expect(validateAnswer({ id: 'x', kind: 'hero', props: {} }, undefined)).toBeNull();
  });
});
