// @formforge/renderer — public renderer bundles (spec §2).
// T11 (issue #11) owns src/scroll/; T12 (issue #12) owns src/conversational/.
// T12 exports the conversational renderer from the package root; the scroll
// renderer export lands with T11 (add it here or via a ./scroll subpath).
export {
  ConversationalRenderer,
  createInitialState,
  createMachineReducer,
  createFetchIngestClient,
  createMockIngestClient,
  IngestError,
  themeToCssVars,
  validateAnswer,
} from './conversational/index';
export type {
  ConversationalRendererProps,
  IngestClient,
  MachineState,
} from './conversational/index';
