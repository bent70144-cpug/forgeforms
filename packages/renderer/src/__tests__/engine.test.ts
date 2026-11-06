// T20 (issue #20) — the conversational renderer's logic MUST run through the
// SAME T13 engine package the server uses (spec §15 M5 acceptance: "Same
// engine package is used on client and server (single import, verified by a
// test)"). The machine compiles and evaluates via `@formforge/core/logic`
// only — this file pins that contract behaviorally (NPS scenario) and by
// identity of the imported engine bindings.
import { describe, expect, it } from 'vitest';
import { compile as coreCompile, evaluate as coreEvaluate } from '@formforge/core/logic';
import type { Rule } from '@formforge/core/logic';
import { buildRouting, engineEvaluate, questionBlocks } from '../conversational/machine/helpers';
import { createInitialState, createMachineReducer } from '../conversational/machine/reducer';
import type { MachineEvent, MachineState } from '../conversational/machine/types';
import { formDoc, machineDocOf, q, rule } from '../conversational/machine/__tests__/fixtures';

function run(
  reducer: ReturnType<typeof createMachineReducer>,
  state: MachineState,
  ...events: MachineEvent[]
): MachineState {
  let current = state;
  for (const event of events) current = reducer(current, event);
  return current;
}

function answerNext(
  reducer: ReturnType<typeof createMachineReducer>,
  state: MachineState,
  blockId: string,
  value: unknown,
): MachineState {
  return run(reducer, state, { type: 'ANSWER', blockId, value }, { type: 'NEXT' });
}

/** Spec §15 M5: "If NPS ≤ 6 go to ending B, otherwise ending A". */
function npsScenario(): Rule[] {
  return [
    {
      id: 'rule_nps_detractor',
      scope: 'q_nps',
      when: [{ left: '@block:q_nps', op: 'lte', right: 6 }],
      then: [{ type: 'goto', target: 'end:end_b' }],
      isFallback: false,
    },
    {
      id: 'rule_nps_otherwise',
      scope: 'q_nps',
      when: [],
      then: [{ type: 'goto', target: 'end:end_a' }],
      isFallback: true,
    },
  ];
}

function bootNps(): { reducer: ReturnType<typeof createMachineReducer>; initial: MachineState } {
  const doc = formDoc({
    blocks: [q('nps', { label: 'How likely to recommend?', required: true }, 'q_nps')],
    endings: [
      { id: 'end_a', title: 'Ending A' },
      { id: 'end_b', title: 'Ending B' },
    ],
    rules: npsScenario(),
  });
  const machineDoc = machineDocOf(doc);
  return { reducer: createMachineReducer(machineDoc), initial: createInitialState(machineDoc) };
}

describe('single engine package (client renderer ≡ server ingest)', () => {
  it('the machine routes through the T13 engine evaluate (identity)', () => {
    expect(engineEvaluate).toBe(coreEvaluate);
  });

  it('buildRouting produces the T13 compiled Routing (lint diagnostics attached)', () => {
    const doc = formDoc({
      blocks: [q('nps', { label: 'NPS' }, 'q_nps')],
      endings: [
        { id: 'end_a', title: 'A' },
        { id: 'end_b', title: 'B' },
      ],
      rules: npsScenario(),
    });
    const routing = buildRouting(doc);
    expect(routing.kind).toBe('routing');
    expect(routing.scopes['start']?.defaultNext).toBe('q_nps');
    expect(routing.scopes['q_nps']?.defaultNext).toBe('end:end_a');
    expect(routing.diagnostics).toEqual([]);
    expect(routing.endings).toEqual(['end_a', 'end_b']);
    // Compiled with the exact compile() the engine package root exports.
    expect(buildRouting(doc)).toEqual(coreCompile(npsScenario(), questionBlocks(doc), ['end_a', 'end_b']));
  });

  it('surfaces engine lint diagnostics (dangling goto names the rule)', () => {
    const doc = formDoc({
      blocks: [q('nps', {}, 'q_nps')],
      endings: [{ id: 'end_a', title: 'A' }],
      rules: [
        {
          id: 'rule_dangling',
          scope: 'q_nps',
          when: [],
          then: [{ type: 'goto', target: 'end:ghost' }],
          isFallback: false,
        },
      ],
    });
    const routing = buildRouting(doc);
    const errors = routing.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.some((d) => d.code === 'dangling_goto' && d.ruleId === 'rule_dangling')).toBe(true);
  });
});

describe('runtime: NPS scenario in the conversational machine (spec §15 M5)', () => {
  it('NPS 4 (≤ 6) routes to ending B', () => {
    const { reducer, initial } = bootNps();
    const next = answerNext(reducer, initial, 'q_nps', 4);
    expect(next.phase).toBe('validating');
    expect(next.pendingEndingId).toBe('end_b');
  });

  it('NPS 9 falls back to ending A ("in all other cases")', () => {
    const { reducer, initial } = bootNps();
    const next = answerNext(reducer, initial, 'q_nps', 9);
    expect(next.phase).toBe('validating');
    expect(next.pendingEndingId).toBe('end_a');
  });
});

describe('runtime: engine semantics through the machine', () => {
  it('default flow: last question ends at the first configured ending', () => {
    const doc = formDoc({
      blocks: [
        q('short-text', { label: 'Name', required: true }, 'b1'),
        q('email', { label: 'Email', required: true }, 'b2'),
      ],
      endings: [{ id: 'end_1', title: 'Thanks!' }],
    });
    const machineDoc = machineDocOf(doc);
    const reducer = createMachineReducer(machineDoc);
    const s0 = createInitialState(machineDoc);
    const s1 = answerNext(reducer, s0, 'b1', 'Ada');
    const s2 = answerNext(reducer, s1, 'b2', 'ada@example.com');
    expect(s2.pendingEndingId).toBe('end_1');
  });

  it('no configured endings: engine falls back to the opaque end: and the machine uses its built-in ending', () => {
    const doc = formDoc({ blocks: [q('short-text', { label: 'Name', required: true }, 'b1')] });
    const machineDoc = machineDocOf(doc);
    expect(machineDoc.routing.scopes['b1']?.defaultNext).toBe('end:');
    const reducer = createMachineReducer(machineDoc);
    const next = answerNext(reducer, createInitialState(machineDoc), 'b1', 'Ada');
    expect(next.pendingEndingId).toBe('');
  });

  it('unknown goto target falls back to the default next (never crash)', () => {
    const doc = formDoc({
      blocks: [
        q('short-text', { label: 'A', required: true }, 'b1'),
        q('email', { label: 'B', required: true }, 'b2'),
      ],
      endings: [{ id: 'end_1', title: 'Thanks!' }],
      rules: [
        rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'eq', right: 'x' }], then: [{ type: 'goto', target: 'ghost' }] }),
      ],
    });
    const machineDoc = machineDocOf(doc);
    const reducer = createMachineReducer(machineDoc);
    const next = answerNext(reducer, createInitialState(machineDoc), 'b1', 'x');
    expect(next.phase).toBe('question');
    expect(next.index).toBe(1);
  });

  it('set actions update the variables map alongside goto', () => {
    const doc = formDoc({
      blocks: [q('nps', { label: 'NPS' }, 'q_nps')],
      endings: [{ id: 'end_1', title: 'Thanks!' }],
      rules: [
        rule({
          scope: 'q_nps',
          when: [{ left: '@block:q_nps', op: 'gte', right: 9 }],
          then: [{ type: 'set', var: 'promoter', value: true }, { type: 'goto', target: 'end:end_1' }],
        }),
      ],
    });
    const machineDoc = machineDocOf(doc);
    const reducer = createMachineReducer(machineDoc);
    const next = answerNext(reducer, createInitialState(machineDoc), 'q_nps', 10);
    expect(next.variables['promoter']).toBe(true);
    expect(next.pendingEndingId).toBe('end_1');
  });
});

describe('runtime: per-question prefill via URL params (spec §7.2 prefillParam)', () => {
  it('createInitialState seeds draft answers for questions with a matching prefillParam', () => {
    const doc = formDoc({
      blocks: [
        q('email', { label: 'Email', prefillParam: 'email' }, 'b1'),
        q('short-text', { label: 'Name' }, 'b2'),
      ],
    });
    const machineDoc = machineDocOf(doc);
    const initial = createInitialState(machineDoc, {}, { email: 'ana@example.com', name: 'ignored' });
    expect(initial.answers['b1']).toBe('ana@example.com');
    expect(initial.answers['b2']).toBeUndefined();
  });

  it('prefilled answers commit through validation like typed ones', () => {
    const doc = formDoc({
      blocks: [q('email', { label: 'Email', required: true, prefillParam: 'email' }, 'b1')],
      endings: [{ id: 'end_1', title: 'Thanks!' }],
    });
    const machineDoc = machineDocOf(doc);
    const reducer = createMachineReducer(machineDoc);
    const next = run(
      reducer,
      createInitialState(machineDoc, {}, { email: 'ana@example.com' }),
      { type: 'NEXT' },
    );
    expect(next.phase).toBe('validating');
    expect(next.committed['b1']?.value).toBe('ana@example.com');
  });
});
