/**
 * T29 — publish-time sensitive-field warning (spec §17: "publish-time check
 * for sensitive fields (card numbers, passwords) with warning").
 *
 * FormForge is a general-purpose form builder; operators should not use it to
 * collect regulated secrets (payment card numbers, passwords, government ids).
 * This scanner runs at PUBLISH time over the draft's question blocks and
 * returns NON-BLOCKING warnings (the publish proceeds — the warning is
 * surfaced in the PublishOutcome so the UI can show a banner and the API
 * response carries it).
 */

import type { BlockJson, DocumentBodyJson, PublishWarning } from './model';

/**
 * Matched against question labels/prompts/keys (case-insensitive, word-ish
 * boundaries). Deliberately over-inclusive: a warning is cheap, a missed
 * regulated field is not.
 */
const SENSITIVE_FIELD_PATTERNS: ReadonlyArray<{ term: string; re: RegExp }> = [
  { term: 'password', re: /\bpass(?:word|wd|phrase)?s?\b/i },
  { term: 'card number', re: /\b(?:card|credit[\s-]?card|debit[\s-]?card|cc)\s*(?:no|number|num|#)?s?\b/i },
  { term: 'CVV/CVC', re: /\b(?:cvv|cvc|card\s*security\s*code|security\s*code)\b/i },
  { term: 'expiry', re: /\b(?:card\s*)?(?:expiry|expiration)\s*(?:date|mm\/yy)?\b/i },
  { term: 'SSN', re: /\b(?:social\s*security|ssn)\b/i },
  { term: 'tax id', re: /\b(?:tax\s*(?:id|number|file)?|ein|vat\s*(?:no|number)?|nif|nic)\b/i },
  { term: 'passport', re: /\bpassports?\b/i },
  { term: 'driver license', re: /\b(?:driver'?s?\s*licen[cs]e|driving\s*licen[cs]e|dl\s*number)\b/i },
  { term: 'bank account', re: /\b(?:bank\s*(?:account|acct|iban)|routing\s*(?:number|no)|sort\s*code|bsb)\b/i },
  { term: 'medical', re: /\b(?:medical\s*(?:record|mrn)|health\s*insurance|insurance\s*(?:policy|no|number))\b/i },
];

/** Question-like block kinds (answerable fields); everything else is ignored. */
const QUESTION_HINT_KEYS = ['label', 'title', 'question', 'prompt', 'name', 'placeholder', 'description'];

function isQuestionish(block: BlockJson): boolean {
  // Unknown/structural kinds (section, hero, …) are skipped; every block kind
  // that can carry an answer is matched by a permissive prop check instead of
  // a hard-coded kind list, so new question blocks are covered by default.
  const props = block.props ?? {};
  return 'label' in props || 'question' in props || 'prompt' in props || 'required' in props || 'name' in props;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Scan a draft body for sensitive-field hints. Returns one warning per
 * (block, matched term) pair, de-duplicated.
 */
export function scanSensitiveFields(body: DocumentBodyJson): PublishWarning[] {
  const warnings: PublishWarning[] = [];
  const seen = new Set<string>();

  const scanBlock = (block: BlockJson, path: string): void => {
    if (!isQuestionish(block)) {
      if (Array.isArray(block.children)) {
        block.children.forEach((child, i) => scanBlock(child, `${path}.children[${i}]`));
      }
      return;
    }
    const props = block.props ?? {};
    const haystacks = QUESTION_HINT_KEYS.map((key) => textOf(props[key]));
    const nameKey = textOf(props.key) || textOf(props.field) || textOf(props.id);
    if (nameKey) haystacks.push(nameKey);
    const text = haystacks.filter((s) => s !== '').join(' \u00b7 ');

    for (const { term, re } of SENSITIVE_FIELD_PATTERNS) {
      if (!re.test(text)) continue;
      const dedupe = `${block.id}:${term}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      warnings.push({
        code: 'SENSITIVE_FIELD',
        message:
          `Question at "${path}" (label "${text.slice(0, 120)}") appears to collect ${term} data. ` +
          'Do not use FormForge to collect regulated secrets (card numbers, passwords, government ids). ' +
          'Consider a dedicated, PCI/HIPAA-compliant collector instead.',
        blockId: block.id,
      });
    }
    if (Array.isArray(block.children)) {
      block.children.forEach((child, i) => scanBlock(child, `${path}.children[${i}]`));
    }
  };

  (body.blocks ?? []).forEach((block, i) => scanBlock(block, `blocks[${i}]`));
  return warnings;
}
