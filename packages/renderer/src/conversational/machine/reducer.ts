// Pure reducer state machine for the conversational renderer (issue #12).
//
//   idle ──START──▶ question[n] ──NEXT(ok)──▶ question[n+1] (or logic jump)
//                     │  ▲                        │
//                     │  └──NEXT(invalid)─────────┘        (last question)
//                     │                                    ▼
//                     └──BACK(n=0)───────────────▶ validating ──SUBMIT──▶ submitting
//                                                                        │        │
//                                                   SUBMIT_SUCCESS ◀─────┘        │ SUBMIT_FAILURE
//                                                        done ◀──────────────── error ──RETRY──▶ submitting
//
// The reducer is fully synchronous and side-effect free: network calls
// (ingest start/save/complete) live in the React layer and re-enter the
// machine through events. This file is the unit under test.
import { evaluate } from '../../bridge';
import { normalizeAnswer, validateAnswer } from '../validation/validateAnswer';
import { resolveEnding } from './helpers';
import type {
  MachineDoc,
  MachineEvent,
  MachineReducer,
  MachineState,
  ResolvedEnding,
} from './types';

export function createInitialState(
  doc: MachineDoc,
  hidden: Record<string, unknown> = {},
): MachineState {
  const noQuestions = doc.questions.length === 0;
  return {
    phase: noQuestions ? 'done' : doc.hasWelcome ? 'idle' : 'question',
    index: 0,
    answers: {},
    committed: {},
    lastCommitted: null,
    variables: {},
    hidden,
    errors: {},
    submissionToken: null,
    pendingEndingId: null,
    submitSeq: 0,
    ending: noQuestions ? resolveEnding(doc.endings, null) : null,
    message: null,
    attempts: 0,
  };
}

export function createMachineReducer(doc: MachineDoc): MachineReducer {
  const { questions, routing } = doc;

  return function machineReducer(state: MachineState, event: MachineEvent): MachineState {
    switch (event.type) {
      case 'START':
        return onStart(state);

      case 'ANSWER':
        return onAnswer(state, event.blockId, event.value);

      case 'NEXT':
        return onNext(state);

      case 'BACK':
        return onBack(state);

      case 'SUBMIT':
        if (state.phase !== 'validating') return state;
        return { ...state, phase: 'submitting', submitSeq: state.submitSeq + 1 };

      case 'SUBMIT_SUCCESS':
        return onSubmitSuccess(state, event);

      case 'SUBMIT_FAILURE':
        if (state.phase !== 'submitting') return state;
        return {
          ...state,
          phase: 'error',
          message: event.message,
          attempts: state.attempts + 1,
        };

      case 'RETRY':
        if (state.phase !== 'error') return state;
        return { ...state, phase: 'submitting', submitSeq: state.submitSeq + 1, message: null };

      default: {
        // Exhaustiveness guard — a new event must be handled explicitly.
        const exhaustive: never = event;
        void exhaustive;
        return state;
      }
    }
  };

  // --- transitions ---------------------------------------------------------

  /** Flatten the committed map (value+ts entries) to plain blockId→value for the logic engine. */
  function committedValues(committed: MachineState['committed']): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const id of Object.keys(committed)) out[id] = committed[id]?.value;
    return out;
  }

  function onStart(state: MachineState): MachineState {
    if (state.phase !== 'idle') return state;
    if (questions.length === 0) {
      return { ...state, phase: 'done', ending: resolveEnding(doc.endings, null) };
    }
    return { ...state, phase: 'question', index: 0, errors: {} };
  }

  function onAnswer(state: MachineState, blockId: string, value: unknown): MachineState {
    if (state.phase !== 'question') return state;
    if (state.answers[blockId] === value) return state;
    const errors = { ...state.errors };
    delete errors[blockId];
    return {
      ...state,
      answers: { ...state.answers, [blockId]: value },
      errors,
    };
  }

  function onNext(state: MachineState): MachineState {
    if (state.phase !== 'question') return state;
    const block = questions[state.index];
    if (!block) return state;

    // 1. Validation gate (client-side mirror of the Zod answer rules).
    const error = validateAnswer(block, state.answers[block.id]);
    if (error) {
      return { ...state, errors: { ...state.errors, [block.id]: error } };
    }

    // 2. Commit the validated answer (drives the ingest save side-effect).
    const entry = {
      value: normalizeAnswer(block, state.answers[block.id]),
      clientTs: new Date().toISOString(),
    };
    const withCommit: MachineState = {
      ...state,
      committed: { ...state.committed, [block.id]: entry },
      lastCommitted: {
        blockId: block.id,
        value: entry.value,
        clientTs: entry.clientTs,
        seq: (state.lastCommitted?.seq ?? 0) + 1,
      },
      errors: {},
    };

    // 3. Resolve the next step through the logic engine (spec §9).
    //    Logic reads committed (validated + normalized) answers only.
    const { nextBlockId, variables } = evaluate(routing, {
      answers: committedValues(withCommit.committed),
      variables: state.variables,
      hidden: state.hidden,
      currentBlockId: block.id,
    });

    if (nextBlockId.startsWith('end:')) {
      return {
        ...withCommit,
        phase: 'validating',
        variables,
        pendingEndingId: nextBlockId.slice(4),
      };
    }

    const jumped = questions.findIndex((q) => q.id === nextBlockId);
    const nextIndex = jumped >= 0 ? jumped : state.index + 1;
    if (nextIndex >= questions.length) {
      return { ...withCommit, phase: 'validating', variables };
    }
    return { ...withCommit, phase: 'question', index: nextIndex, variables };
  }

  function onBack(state: MachineState): MachineState {
    switch (state.phase) {
      case 'question':
        if (state.index > 0) return { ...state, index: state.index - 1, errors: {} };
        return doc.hasWelcome ? { ...state, phase: 'idle' } : state;
      case 'validating':
      case 'error':
        return {
          ...state,
          phase: 'question',
          message: null,
          pendingEndingId: null,
          errors: {},
        };
      default:
        return state;
    }
  }

  function onSubmitSuccess(
    state: MachineState,
    event: Extract<MachineEvent, { type: 'SUBMIT_SUCCESS' }>,
  ): MachineState {
    if (state.phase !== 'submitting') return state;
    // Server ending is authoritative (spec §10.3 complete response);
    // fall back to the logic-resolved ending, then the first configured one.
    const ending: ResolvedEnding = resolveEnding(doc.endings, event.endingId ?? state.pendingEndingId);
    const redirectUrl = event.redirectUrl ?? ending.redirectUrl;
    return {
      ...state,
      phase: 'done',
      submissionToken: event.token ?? state.submissionToken,
      ending: { ...ending, redirectUrl },
      message: null,
    };
  }
}
