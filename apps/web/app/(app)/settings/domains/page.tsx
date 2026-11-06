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
    <div className="w-full max-w-3xl">
      <header>
        <p className="text-[13px] font-medium text-[var(--ff-muted)]">Settings</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">Custom domains</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--ff-muted)]">
          Serve a published document from your own hostname. Add the domain, publish the DNS records
          shown after you add it, then verify — traffic only routes once ownership is confirmed, so
          an unverified domain can never serve your forms.
        </p>
        <div className="mt-6">
          <SettingsTabs current="domains" />
        </div>
      </header>
      <DomainsClient />
    </div>
  );
}
