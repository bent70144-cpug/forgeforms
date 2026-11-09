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
          Custom domains
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--ff-muted)]">
          Serve a published document from your own hostname. Add the domain, publish the DNS records
          shown after you add it, then verify — traffic only routes once ownership is confirmed, so
          an unverified domain can never serve your forms.
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
