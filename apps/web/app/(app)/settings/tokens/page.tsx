import type { Metadata } from 'next';
import { TokensClient } from './tokens-client';

export const metadata: Metadata = {
  title: 'API tokens — FormForge',
  description: 'Create and revoke scoped API tokens for the FormForge /api/v1.',
};

/** Settings → API tokens (spec §14.1.8, issue #25). */
export default function TokensSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm text-[var(--ff-muted)]">Settings</p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">API tokens</h1>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-[var(--ff-muted)]">
          Tokens authenticate requests to{' '}
          <code className="rounded bg-[var(--ff-bg)] px-1">/api/v1</code> with{' '}
          <code className="rounded bg-[var(--ff-bg)] px-1">Authorization: Bearer ff_…</code>. Each token is
          limited to its scopes and to this workspace. The plaintext is shown{' '}
          <strong>once</strong> at creation — only a SHA-256 hash is stored.
        </p>
      </header>
      <TokensClient />
    </div>
  );
}
