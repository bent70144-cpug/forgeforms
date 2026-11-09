import type { Metadata } from 'next';
import { TokensClient } from './tokens-client';
import { SettingsTabs } from '@/components/settings/settings-tabs';

export const metadata: Metadata = {
  title: 'API tokens — FormForge',
  description: 'Create and revoke scoped API tokens for the FormForge /api/v1.',
};

/** Settings → API tokens (spec §14.1.8, issue #25). */
export default function TokensSettingsPage() {
  return (
    // Page container matches billing (max-w-5xl) so the shared SettingsTabs
    // glass rail and the header rhythm stay identical across all three
    // settings tabs; the client content below keeps its 48rem reading measure.
    <div className="w-full max-w-5xl">
      <header className="max-w-3xl">
        <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ff-muted)]">
          <span
            aria-hidden="true"
            className="h-px w-6 rounded-full"
            style={{ background: 'var(--ff-grad)' }}
          />
          Settings
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
          API tokens
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--ff-muted)]">
          Tokens authenticate requests to{' '}
          <code className="rounded bg-[var(--ff-bg)] px-1 font-mono text-[13px]">/api/v1</code> with{' '}
          <code className="rounded bg-[var(--ff-bg)] px-1 font-mono text-[13px]">
            Authorization: Bearer ff_…
          </code>
          . Each token is limited to its scopes and to this workspace. The plaintext is shown{' '}
          <strong>once</strong> at creation — only a SHA-256 hash is stored.
        </p>
      </header>
      <div className="mt-6">
        <SettingsTabs current="tokens" />
      </div>
      <div className="mt-8 max-w-3xl">
        <TokensClient />
      </div>
    </div>
  );
}
