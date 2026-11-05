import type { Metadata } from 'next';
import { TokensClient } from './tokens-client';

export const metadata: Metadata = {
  title: 'API tokens — FormForge',
  description: 'Create and revoke scoped API tokens for the FormForge /api/v1.',
};

/** Settings → API tokens (spec §14.1.8, issue #25). */
export default function TokensSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm text-slate-500">Settings</p>
        <h1 className="text-2xl font-semibold tracking-tight">API tokens</h1>
        <p className="mt-2 max-w-prose text-sm text-slate-600">
          Tokens authenticate requests to <code className="rounded bg-slate-100 px-1">/api/v1</code> with{' '}
          <code className="rounded bg-slate-100 px-1">Authorization: Bearer ff_…</code>. Each token is
          limited to its scopes and to this workspace. The plaintext is shown{' '}
          <strong>once</strong> at creation — only a SHA-256 hash is stored.
        </p>
      </header>
      <TokensClient />
    </main>
  );
}
