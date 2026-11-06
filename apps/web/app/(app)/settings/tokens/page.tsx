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
    <div className="w-full max-w-3xl">
      <header>
        <p className="text-[13px] font-medium text-[var(--ff-muted)]">Settings</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">API tokens</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--ff-muted)]">
          Tokens authenticate requests to{' '}
          <code className="rounded bg-[var(--ff-bg)] px-1 font-mono text-[13px]">/api/v1</code> with{' '}
          <code className="rounded bg-[var(--ff-bg)] px-1 font-mono text-[13px]">
            Authorization: Bearer ff_…
          </code>
          . Each token is limited to its scopes and to this workspace. The plaintext is shown{' '}
          <strong>once</strong> at creation — only a SHA-256 hash is stored.
        </p>
        <div className="mt-6">
          <SettingsTabs current="tokens" />
        </div>
      </header>
      <TokensClient />
    </div>
  );
}
