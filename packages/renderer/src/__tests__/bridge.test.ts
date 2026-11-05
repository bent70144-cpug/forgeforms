// Tests for the bridge logic stub (spec §9 semantics the renderer relies on).
// INTEGRATION-DEBT: replaced wholesale by @formforge/core logic tests when T13 lands.
import { describe, expect, it } from 'vitest';
import { compile, evaluate, type Block, type Rule } from '../bridge';
import { q, rule } from '../conversational/machine/__tests__/fixtures';

const blocks: Block[] = [q('nps', {}, 'b1'), q('short-text', {}, 'b2'), q('email', {}, 'b3')];

function ctx(overrides: Partial<Parameters<typeof evaluate>[1]> = {}) {
  return {
    answers: {},
    variables: {},
    hidden: {},
    currentBlockId: 'b1',
    ...overrides,
  };
}

describe('compile', () => {
  it('indexes question blocks in document order and rules by scope', () => {
    const rules: Rule[] = [rule({ scope: 'b1' }), rule({ scope: 'start' })];
    const routing = compile(rules, blocks);
    expect(routing.order).toEqual(['b1', 'b2', 'b3']);
    expect(Object.keys(routing.rulesByScope).sort()).toEqual(['b1', 'start']);
  });

  it('sorts fallback rules last within a scope', () => {
    const rules: Rule[] = [
      rule({ scope: 'b1', isFallback: true, then: [{ type: 'goto', target: 'b3' }] }),
      rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'gt', right: 5 }], then: [{ type: 'goto', target: 'b2' }] }),
    ];
    const routing = compile(rules, blocks);
    expect(routing.rulesByScope['b1']?.[0]?.isFallback).toBeUndefined();
    expect(routing.rulesByScope['b1']?.[1]?.isFallback).toBe(true);
  });

  it('excludes hidden and unknown-kind blocks from the order', () => {
    const routing = compile(
      [],
      [...blocks, { id: 'bh', kind: 'short-text', props: {}, hidden: true }, { id: 'bc', kind: 'hero', props: {} }],
    );
    expect(routing.order).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('evaluate: default next', () => {
  it('returns the next question in order', () => {
    const routing = compile([], blocks);
    expect(evaluate(routing, ctx()).nextBlockId).toBe('b2');
  });

  it('returns end:<first ending> after the last question', () => {
    const routing = compile([], blocks);
    const result = evaluate(routing, ctx({ currentBlockId: 'b3' }));
    expect(result.nextBlockId).toBe('end:default');
  });

  it('uses the first configured ending id', () => {
    const routing = compile([], blocks);
    routing.endings = ['end_7'];
    expect(evaluate(routing, ctx({ currentBlockId: 'b3' })).nextBlockId).toBe('end:end_7');
  });
});

describe('evaluate: rules', () => {
  it('first matching rule wins and goto targets are honored', () => {
    const rules: Rule[] = [
      rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'lte', right: 6 }], then: [{ type: 'goto', target: 'b3' }] }),
      rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'gte', right: 0 }], then: [{ type: 'goto', target: 'b2' }] }),
    ];
    const routing = compile(rules, blocks);
    expect(evaluate(routing, ctx({ answers: { b1: 3 } })).nextBlockId).toBe('b3');
    expect(evaluate(routing, ctx({ answers: { b1: 9 } })).nextBlockId).toBe('b2');
  });

  it('end: targets pass through untouched', () => {
    const rules: Rule[] = [
      rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'eq', right: 10 }], then: [{ type: 'goto', target: 'end:end_promoter' }] }),
    ];
    const routing = compile(rules, blocks);
    expect(evaluate(routing, ctx({ answers: { b1: 10 } })).nextBlockId).toBe('end:end_promoter');
  });

  it('unknown goto targets fall back to the default next (never crash)', () => {
    const rules: Rule[] = [rule({ scope: 'b1', when: [], then: [{ type: 'goto', target: 'ghost' }] })];
    const routing = compile(rules, blocks);
    expect(evaluate(routing, ctx()).nextBlockId).toBe('b2');
  });

  it('set actions update variables even alongside goto', () => {
    const rules: Rule[] = [
      rule({
        scope: 'b1',
        when: [],
        then: [{ type: 'set', var: 'flag', value: 'yes' }, { type: 'goto', target: 'b3' }],
      }),
    ];
    const routing = compile(rules, blocks);
    const result = evaluate(routing, ctx());
    expect(result.nextBlockId).toBe('b3');
    expect(result.variables['flag']).toBe('yes');
  });

  it('supports isEmpty, contains and matches operators', () => {
    const routing = compile(
      [
        rule({ scope: 'b1', id: 'r-empty', when: [{ left: '@block:b1', op: 'isEmpty' }], then: [{ type: 'goto', target: 'b2' }] }),
        rule({ scope: 'b1', id: 'r-contains', when: [{ left: '@block:b2', op: 'contains', right: 'vip' }], then: [{ type: 'goto', target: 'b3' }] }),
        rule({ scope: 'b1', id: 'r-matches', when: [{ left: '@block:b2', op: 'matches', right: '^\\d+$' }], then: [{ type: 'goto', target: 'end:end_num' }] }),
      ],
      blocks,
    );
    expect(evaluate(routing, ctx({ answers: { b1: '' } })).nextBlockId).toBe('b2');
    expect(evaluate(routing, ctx({ answers: { b1: 5, b2: 'i am vip' } })).nextBlockId).toBe('b3');
    expect(evaluate(routing, ctx({ answers: { b1: 5, b2: '42' } })).nextBlockId).toBe('end:end_num');
    // Invalid regex must not throw:
    expect(
      evaluate(
        compile([rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'matches', right: '[' }], then: [] })], blocks),
        ctx({ answers: { b1: 1 } }),
      ).nextBlockId,
    ).toBe('b2');
  });

  it('unwraps select answer shapes for operand comparison', () => {
    const routing = compile(
      [rule({ scope: 'b1', when: [{ left: '@block:b1', op: 'eq', right: 'o2' }], then: [{ type: 'goto', target: 'b3' }] })],
      blocks,
    );
    expect(evaluate(routing, ctx({ answers: { b1: { optionId: 'o2' } } })).nextBlockId).toBe('b3');
    expect(evaluate(routing, ctx({ answers: { b1: { other: 'custom' } } })).nextBlockId).toBe('b2');
  });

  it('resolves @var and @hidden operands', () => {
    const routing = compile(
      [
        rule({ scope: 'b1', id: 'r-var', when: [{ left: '@var:plan', op: 'eq', right: 'pro' }], then: [{ type: 'goto', target: 'b2' }] }),
        rule({ scope: 'b1', id: 'r-hidden', when: [{ left: '@hidden:utm_source', op: 'eq', right: 'ads' }], then: [{ type: 'goto', target: 'b3' }] }),
      ],
      blocks,
    );
    expect(evaluate(routing, ctx({ variables: { plan: 'pro' } })).nextBlockId).toBe('b2');
    expect(evaluate(routing, ctx({ hidden: { utm_source: 'ads' } })).nextBlockId).toBe('b3');
  });
});
