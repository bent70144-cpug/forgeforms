import type { Metadata } from 'next';
import { DomainsClient } from './domains-client';
import { SettingsTabs } from '@/components/settings/settings-tabs';

export const metadata: Metadata = {
  title: 'Custom domains — FormForge',
  description: 'Attach a custom hostname to a published document, verify DNS ownership, and route traffic.',
};

/** Settings → Custom domains (spec §14.1.8 settings surface, issue #24). */
export default function DomainsSettingsPage() {
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
          Custom domains
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--ff-muted)]">
          Serve a published document from your own hostname — add the domain, publish the DNS
          records, then verify ownership before traffic routes.
        </p>
      </header>
      <div className="mt-6">
        <SettingsTabs current="domains" />
      </div>
      <div className="mt-8 max-w-3xl">
        <DomainsClient />
      </div>
    </div>
  );
}
