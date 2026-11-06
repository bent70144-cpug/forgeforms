import type { Metadata } from 'next';
import { DomainsClient } from './domains-client';

export const metadata: Metadata = {
  title: 'Custom domains — FormForge',
  description: 'Attach a custom hostname to a published document, verify DNS ownership, and route traffic.',
};

/** Settings → Custom domains (spec §14.1.8 settings surface, issue #24). */
export default function DomainsSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm text-slate-500">Settings</p>
        <h1 className="text-2xl font-semibold tracking-tight">Custom domains</h1>
        <p className="mt-2 max-w-prose text-sm text-slate-600">
          Serve a published document from your own hostname. Add the domain, publish the two DNS
          records shown below, then verify — FormForge checks ownership before any traffic routes,
          so an unverified domain can never serve your forms.
        </p>
      </header>
      <DomainsClient />
    </main>
  );
}
