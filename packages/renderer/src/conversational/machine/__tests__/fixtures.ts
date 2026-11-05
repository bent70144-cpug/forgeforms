// Shared fixtures for conversational renderer machine tests.
import type { Block, DocumentBody, Ending, Rule } from '../../../bridge';
import { buildMachineDoc } from '../helpers';
import type { MachineDoc } from '../types';

let counter = 0;

export function q(kind: Block['kind'], props: Record<string, unknown> = {}, id?: string): Block {
  counter += 1;
  return { id: id ?? `b${counter}`, kind, props };
}

export function rule(partial: Partial<Rule> & { scope: string }): Rule {
  counter += 1;
  return {
    id: partial.id ?? `r${counter}`,
    scope: partial.scope,
    when: partial.when ?? [],
    then: partial.then ?? [],
    isFallback: partial.isFallback,
  };
}

export interface DocOptions {
  blocks?: Block[];
  endings?: Ending[];
  rules?: Rule[];
  welcome?: { enabled?: boolean; title?: string; body?: string; buttonText?: string };
  settings?: {
    progressBar?: boolean;
    autoAdvance?: boolean;
    showBranding?: boolean;
    captcha?: boolean;
  };
}

export function formDoc(options: DocOptions = {}): DocumentBody {
  const { blocks = [], endings = [], rules = [], welcome, settings } = options;
  return {
    schemaVersion: 1,
    type: 'form',
    theme: { tokens: {}, fontHeading: 'Inter', fontBody: 'Inter', radius: 'md' },
    settings: {
      progressBar: true,
      autoAdvance: true,
      showBranding: true,
      captcha: false,
      ...settings,
    },
    blocks,
    endings,
    logic: { rules },
    ...(welcome ? { welcome } : {}),
  };
}

export function machineDocOf(doc: DocumentBody, documentId = 'doc_1'): MachineDoc {
  return buildMachineDoc(doc, documentId);
}

/** Standard 3-question form: required short-text → required email → required nps. */
export function basicDoc(): DocumentBody {
  return formDoc({
    blocks: [
      q('short-text', { label: 'Your name', required: true }, 'b1'),
      q('email', { label: 'Your email', required: true }, 'b2'),
      q('nps', { label: 'How likely to recommend?', required: true }, 'b3'),
    ],
    endings: [{ id: 'end_1', title: 'Thanks!', body: 'We got your response.' }],
  });
}
