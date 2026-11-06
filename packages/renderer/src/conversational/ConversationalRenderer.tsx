"use client";

// ConversationalRenderer — the client bundle for forms (spec §10.2, issue #12).
// One question at a time, progress bar, up/down arrows, auto-advance <300ms on
// instant-answer kinds, keyboard flows, inline validation, welcome/ending
// screens, branding badge. Reads only the snapshot; all persistence goes
// through the IngestClient seam (spec §10.3). The business rules live in the
// pure reducer (machine/reducer.ts) — this component is a thin effect shell.
'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DocumentBody } from '../document-model';
import { swallowEscape } from './inputs/shared';
import { createFetchIngestClient } from './ingest/fetchIngestClient';
import type { IngestClient } from './ingest/types';
import { buildMachineDoc, isInstantAnswer } from './machine/helpers';
import { createInitialState, createMachineReducer } from './machine/reducer';
import { BrandingBadge } from './components/BrandingBadge';
import { NavArrows } from './components/NavArrows';
import { ProgressBar } from './components/ProgressBar';
import { CONVERSATIONAL_STYLES } from './styles';
import { themeToCssVars } from './theme';
import { EndingScreen } from './screens/EndingScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';

/** spec §10.2: auto-advance must land under 300 ms. */
export const AUTO_ADVANCE_MS = 250;
/** spec §15 M3 acceptance: ending screens follow redirectUrl when set. */
const REDIRECT_DELAY_MS = 1500;

export interface ConversationalRendererProps {
  documentId: string;
  /** Published snapshot body (fetched from /api/public/snapshot/:documentId). */
  document: DocumentBody;
  /** Hidden field values captured at start (UTM etc., spec §10.3). */
  hidden?: Record<string, unknown>;
  /**
   * URL params for per-question prefill (spec §7.2 `prefillParam`): seeds
   * DRAFT answers for matching questions; the user confirms them via NEXT.
   * T20 (issue #20) — pass e.g. `Object.fromEntries(searchParams)`.
   */
  urlParams?: Record<string, string>;
  /** Transport override; defaults to fetch against the public plane. */
  ingest?: IngestClient;
  /**
   * API origin for the default fetch ingest client.
   * SPEC-NOTE: spec §10.1 pins /api/public/submissions* routes (not
   * /api/public/ingest/* as sketched in the ticket); override here if the
   * deployed gateway differs.
   */
  apiBaseUrl?: string;
  /** Ending-screen auto-redirect delay in ms (0 = immediate). */
  redirectDelayMs?: number;
  /** Fired once when the submission completes (used by the embed postMessage API). */
  onDone?: (info: { endingId: string; token: string | null; redirectUrl: string | null }) => void;
  className?: string;
}

const busyingStyle: CSSProperties = {
  color: 'var(--ff-muted)',
  fontSize: 15,
};

export function ConversationalRenderer(props: ConversationalRendererProps) {
  const { documentId, document, onDone, className, redirectDelayMs = REDIRECT_DELAY_MS } = props;

  const machineDoc = useMemo(() => buildMachineDoc(document, documentId), [document, documentId]);
  const reducer = useMemo(() => createMachineReducer(machineDoc), [machineDoc]);
  const [state, dispatch] = useReducer(reducer, props.hidden ?? {}, (hidden) =>
    createInitialState(machineDoc, hidden, props.urlParams),
  );

  const ingest = useMemo(
    () => props.ingest ?? createFetchIngestClient({ baseUrl: props.apiBaseUrl ?? '' }),
    [props.ingest, props.apiBaseUrl],
  );
  const ingestRef = useRef(ingest);
  ingestRef.current = ingest;

  const questions = machineDoc.questions;
  const currentBlock = state.phase === 'question' ? questions[state.index] : undefined;
  const currentAnswer = currentBlock ? state.answers[currentBlock.id] : undefined;
  const hasWelcome = machineDoc.hasWelcome;

  // --- ingest session (start once, retry on failure) -----------------------

  const startPromiseRef = useRef<Promise<string> | null>(null);
  const honeypotRef = useRef('');
  const hiddenKey = JSON.stringify(props.hidden ?? {});

  const ensureStarted = useCallback((): Promise<string> => {
    if (!startPromiseRef.current) {
      const client = ingestRef.current;
      startPromiseRef.current = client
        .start({
          documentId,
          hidden: JSON.parse(hiddenKey) as Record<string, unknown>,
          honeypot: honeypotRef.current,
        })
        .then(
          (result) => result.token,
          (error) => {
            startPromiseRef.current = null; // allow a retry on the next attempt
            throw error;
          },
        );
    }
    return startPromiseRef.current;
  }, [documentId, hiddenKey]);

  // --- side effects wired to machine transitions ---------------------------

  // Welcome screen: Enter starts the flow (Typeform-style).
  useEffect(() => {
    if (state.phase !== 'idle') return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        dispatch({ type: 'START' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.phase]);

  // Remember the value a question was entered with, so simply revisiting a
  // pre-filled question never auto-advances on its own.
  const enteredValueRef = useRef<{ id: string; value: unknown }>({ id: '', value: undefined });
  useEffect(() => {
    if (state.phase === 'question' && currentBlock) {
      enteredValueRef.current = { id: currentBlock.id, value: state.answers[currentBlock.id] };
    }
    // (deps pinned intentionally: capture entry value only)
  }, [state.phase, state.index]);

  // Auto-advance for instant-answer kinds (single-select, dropdown, rating, nps).
  useEffect(() => {
    if (state.phase !== 'question' || !currentBlock) return;
    if (!machineDoc.settings.autoAdvance || !isInstantAnswer(currentBlock.kind)) return;
    const entered = enteredValueRef.current;
    if (entered.id === currentBlock.id && entered.value === currentAnswer) return;
    const timer = window.setTimeout(() => dispatch({ type: 'NEXT' }), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
    // (deps pinned intentionally: reschedule per answer change)
  }, [state.phase, state.index, currentAnswer]);

  // Save every committed answer (spec §10.3 PATCH, Idempotency-Key per step).
  useEffect(() => {
    const commit = state.lastCommitted;
    if (!commit) return;
    void (async () => {
      try {
        const token = await ensureStarted();
        await ingestRef.current.save(token, {
          answers: [{ blockId: commit.blockId, value: commit.value, clientTs: commit.clientTs }],
          idempotencyKey: `save-${commit.seq}-${commit.blockId}`,
        });
      } catch {
        // Best-effort: complete() re-sends every touched answer (spec §10.3),
        // so a failed step save must never block the respondent.
      }
    })();
  }, [state.lastCommitted, ensureStarted]);

  // validating → submitting: the pure machine never starts I/O itself; this
  // effect is the only bridge into the async submit pipeline below.
  useEffect(() => {
    if (state.phase === 'validating') dispatch({ type: 'SUBMIT' });
  }, [state.phase]);

  // Run the submit pipeline whenever the machine enters `submitting`.
  useEffect(() => {
    if (state.phase !== 'submitting') return;
    void (async () => {
      try {
        const token = await ensureStarted();
        const answers = Object.keys(state.committed).map((blockId) => {
          const entry = state.committed[blockId];
          return { blockId, value: entry?.value, clientTs: entry?.clientTs ?? new Date().toISOString() };
        });
        const result = await ingestRef.current.complete(token, { answers });
        dispatch({
          type: 'SUBMIT_SUCCESS',
          token,
          endingId: result.endingId ?? null,
          redirectUrl: result.redirectUrl ?? null,
        });
      } catch (error) {
        dispatch({
          type: 'SUBMIT_FAILURE',
          message:
            error instanceof Error
              ? error.message
              : 'Something went wrong while sending your response. Please try again.',
        });
      }
    })();
    // (deps pinned intentionally: keyed on submitSeq)
  }, [state.phase, state.submitSeq, ensureStarted]);

  // Completion callback for hosts (embed postMessage API lands via M6).
  useEffect(() => {
    if (state.phase !== 'done' || !state.ending) return;
    onDone?.({
      endingId: state.ending.id,
      token: state.submissionToken,
      redirectUrl: state.ending.redirectUrl,
    });
    // (deps pinned intentionally: fire once per completion)
  }, [state.phase]);

  // --- derived view data ----------------------------------------------------

  const total = questions.length;
  const progressPercent = (() => {
    if (state.phase === 'done') return 100;
    if (total === 0) return 0;
    const filled = state.phase === 'question' ? state.index : state.index + 1;
    return Math.round((Math.min(filled, total) / total) * 100);
  })();

  const canGoBack =
    state.phase === 'validating' ||
    state.phase === 'error' ||
    (state.phase === 'question' && (state.index > 0 || hasWelcome));

  const onKeyDownRoot = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    swallowEscape(event); // Esc is a no-op per ticket (never closes the form)
  };

  const navNext = useCallback(() => dispatch({ type: 'NEXT' }), []);
  const navBack = useCallback(() => dispatch({ type: 'BACK' }), []);
  const start = useCallback(() => dispatch({ type: 'START' }), []);
  const retry = useCallback(() => dispatch({ type: 'RETRY' }), []);
  const answer = useCallback((blockId: string) => (value: unknown) => {
    dispatch({ type: 'ANSWER', blockId, value });
  }, []);

  const themeVars = useMemo(() => themeToCssVars(document.theme), [document]);

  return (
    <div
      className={['ff-root', className].filter(Boolean).join(' ')}
      style={themeVars as CSSProperties}
      onKeyDown={onKeyDownRoot}
      data-ff-phase={state.phase}
    >
      <style dangerouslySetInnerHTML={{ __html: CONVERSATIONAL_STYLES }} />

      <ProgressBar percent={progressPercent} visible={machineDoc.settings.progressBar && state.phase !== 'idle'} />

      {state.phase === 'idle' && (
        <WelcomeScreen
          title={document.welcome?.title || document.title || 'Form'}
          body={document.welcome?.body || undefined}
          buttonText={document.welcome?.buttonText || 'Start'}
          onStart={start}
        />
      )}

      {state.phase === 'question' && currentBlock && (
        <QuestionScreen
          key={currentBlock.id}
          block={currentBlock}
          number={state.index + 1}
          total={total}
          value={currentAnswer}
          error={state.errors[currentBlock.id] ?? null}
          onChange={answer(currentBlock.id)}
          onSubmit={navNext}
        />
      )}

      {(state.phase === 'validating' || state.phase === 'submitting') && (
        <section className="ff-screen" aria-live="polite">
          <p style={busyingStyle}>{state.phase === 'validating' ? 'Checking your answer…' : 'Sending…'}</p>
        </section>
      )}

      {state.phase === 'done' && state.ending && (
        <EndingScreen
          title={state.ending.title}
          body={state.ending.body}
          redirectUrl={state.ending.redirectUrl}
          redirectDelayMs={redirectDelayMs}
        />
      )}

      {state.phase === 'error' && (
        <section className="ff-screen" role="alert">
          <h2 className="ff-question-label">Something went wrong</h2>
          <p className="ff-question-desc">{state.message ?? 'Please try again.'}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="ff-continue" onClick={retry}>
              Try again
            </button>
            <button
              type="button"
              className="ff-continue"
              style={{ background: 'transparent', color: 'var(--ff-fg)', border: '1px solid var(--ff-border)' }}
              onClick={navBack}
            >
              Back to questions
            </button>
          </div>
        </section>
      )}

      {/* Honeypot: must stay empty; bots that fill it are marked spam server-side. */}
      <input
        type="text"
        name="_hp"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
        onChange={(event) => {
          honeypotRef.current = event.target.value;
        }}
      />

      <footer className="ff-footer">
        <BrandingBadge visible={machineDoc.settings.showBranding} />
        {(state.phase === 'question' || state.phase === 'validating' || state.phase === 'error') && (
          <NavArrows onBack={navBack} onNext={navNext} canGoBack={canGoBack} />
        )}
      </footer>
    </div>
  );
}
