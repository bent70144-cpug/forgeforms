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
    // underline rail and the header rhythm stay identical across all three
    // settings tabs; the client content below keeps its 48rem reading measure.
    <div className="w-full max-w-5xl">
      <header className="max-w-3xl">
        <p
          className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ff-muted)]"
          style={{ fontFamily: 'var(--ff-font-mono)' }}
        >
          <span
            aria-hidden="true"
            className="h-px w-6"
            style={{ background: 'var(--ff-border-strong)' }}
          />
          Settings
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
          API tokens
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--ff-muted)]">
          Create and revoke scoped tokens for{' '}
          <code
            className="rounded bg-[var(--ff-bg-2)] px-1 text-[13px]"
            style={{ fontFamily: 'var(--ff-font-mono)' }}
          >
            /api/v1
          </code>{' '}
          — the plaintext is shown once at creation; only a SHA-256 hash is stored.
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
