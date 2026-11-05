// @formforge/renderer/conversational — public API (T12, spec §10.2).
export { ConversationalRenderer, AUTO_ADVANCE_MS } from './ConversationalRenderer';
export type { ConversationalRendererProps } from './ConversationalRenderer';
export { createInitialState, createMachineReducer } from './machine/reducer';
export type {
  MachineDoc,
  MachineEvent,
  MachineReducer,
  MachineState,
  NormalizedSettings,
  Phase,
  ResolvedEnding,
} from './machine/types';
export {
  buildMachineDoc,
  isInstantAnswer,
  isQuestionKind,
  normalizeSettings,
  questionBlocks,
  resolveEnding,
} from './machine/helpers';
export { validateAnswer, normalizeAnswer, MSG_REQUIRED } from './validation/validateAnswer';
export { createFetchIngestClient, PUBLIC_INGEST_PATHS } from './ingest/fetchIngestClient';
export { createMockIngestClient } from './ingest/mockIngestClient';
export { IngestError } from './ingest/types';
export type {
  IngestAnswerStep,
  IngestClient,
  IngestCompleteInput,
  IngestCompleteResult,
  IngestSaveInput,
  IngestSaveResult,
  IngestStartInput,
  IngestStartResult,
} from './ingest/types';
export { themeToCssVars } from './theme';
export type { ThemeVars } from './theme';
export { ProgressBar } from './components/ProgressBar';
export { NavArrows } from './components/NavArrows';
export { BrandingBadge } from './components/BrandingBadge';
export { WelcomeScreen } from './screens/WelcomeScreen';
export { QuestionScreen } from './screens/QuestionScreen';
export { EndingScreen } from './screens/EndingScreen';
