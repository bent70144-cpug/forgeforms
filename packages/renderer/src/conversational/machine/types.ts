// Conversational renderer state machine — public types (spec §10.2, issue #12).
// The machine is a pure reducer: idle → question[n] → validating → submitting → done/error.
// The React client component consumes it; unit tests drive it directly.
// T20 (issue #20): `Routing` is the T13 engine's compiled program
// (`@formforge/core/logic`) — same engine package on client and server.
import type { Routing } from '@formforge/core/logic';
import type { Block, DocumentBody, Ending } from '../../document-model';

export type Phase = 'idle' | 'question' | 'validating' | 'submitting' | 'done' | 'error';

/** One committed (validated) answer — the unit the ingest save/complete APIs receive. */
export interface CommittedAnswer {
  blockId: string;
  value: unknown;
  clientTs: string; // ISO timestamp, spec §10.3
  seq: number; // monotonic, drives the save side-effect exactly once per commit
}

export interface ResolvedEnding {
  id: string;
  title: string;
  body: string | null;
  redirectUrl: string | null;
}

export interface NormalizedSettings {
  progressBar: boolean;
  autoAdvance: boolean;
  showBranding: boolean;
  captcha: boolean;
}

/** Immutable document context the reducer closure captures at creation time. */
export interface MachineDoc {
  documentId: string;
  document: DocumentBody;
  /** Question blocks in flow order (question kinds only, hidden blocks excluded). */
  questions: Block[];
  routing: Routing;
  settings: NormalizedSettings;
  hasWelcome: boolean;
  endings: Ending[];
}

export interface MachineState {
  phase: Phase;
  /** Index into MachineDoc.questions (question/validating phases). */
  index: number;
  /** Draft answer values, keyed by blockId (may be uncommitted edits). */
  answers: Record<string, unknown>;
  /** Answers that passed validation and were committed via NEXT (goes to ingest). */
  committed: Record<string, { value: unknown; clientTs: string }>;
  /** The most recent commit — the React layer fires ingest.save() when it changes. */
  lastCommitted: CommittedAnswer | null;
  /** Variables produced by the logic engine (spec §9 `set` actions). */
  variables: Record<string, unknown>;
  /** Hidden field values captured at start (UTM etc., spec §10.3). */
  hidden: Record<string, unknown>;
  /** blockId → validation message, for the current question. */
  errors: Record<string, string>;
  submissionToken: string | null;
  /** `end:<id>` target resolved by the logic engine, if any (validating phase). */
  pendingEndingId: string | null;
  /** Increments every time the submitting phase is entered — drives the submit effect. */
  submitSeq: number;
  ending: ResolvedEnding | null;
  /** Error-phase message (submit failure or fatal configuration error). */
  message: string | null;
  attempts: number;
}

export type MachineEvent =
  /** Leave the welcome screen and start the flow. */
  | { type: 'START' }
  /** Record a draft answer for a block (no validation yet). */
  | { type: 'ANSWER'; blockId: string; value: unknown }
  /** Validate the current question and advance (Enter / button / auto-advance). */
  | { type: 'NEXT' }
  /** Step back one question (up arrow). */
  | { type: 'BACK' }
  /** validating → submitting (dispatched by the client when validation passed). */
  | { type: 'SUBMIT' }
  | {
      type: 'SUBMIT_SUCCESS';
      token: string | null;
      endingId: string | null;
      redirectUrl: string | null;
    }
  | { type: 'SUBMIT_FAILURE'; message: string }
  /** error → submitting again (retry the network call). */
  | { type: 'RETRY' };

export type MachineReducer = (state: MachineState, event: MachineEvent) => MachineState;
