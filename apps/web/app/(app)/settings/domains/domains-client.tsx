'use client';

// Custom domains settings UI (issue #24, spec §14 settings, §13 quota UX).
// Flow mirrors the API: add (pending + DNS instructions) → verify (ownership
// check; unverified NEVER routes) → remove (unroute + cache purge). The 402
// PLAN_LIMIT response surfaces as an upgrade prompt HERE (spec §13: upgrade
// prompts live only in settings and the error response, never in editing
// surfaces).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CustomDomain, DnsRecordInstruction } from '@formforge/schema/api';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; domains: CustomDomain[] }
  | { kind: 'error'; message: string };

type DocumentOption = { id: string; title: string };

type PlanLimit = { capability: string; requiredPlan: string | null };

// Shared control recipes — token-driven so they flip with dark mode.
const INPUT =
  'w-full rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-3 py-2 text-sm text-[var(--ff-fg)] transition-colors placeholder:text-[var(--ff-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ff-primary)]';
const BTN_PRIMARY =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-transparent bg-[var(--ff-primary)] px-4 text-sm font-medium text-[var(--ff-primary-fg)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY_SM =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-2.5 text-xs font-medium text-[var(--ff-fg)] transition-colors hover:border-[var(--ff-muted)] hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,var(--ff-card))] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_DESTRUCTIVE_SM =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-red-300/50 bg-[var(--ff-card)] px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400/30 dark:text-red-400';
const BTN_RETRY =
  'mt-3 inline-flex h-8 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-current/40 bg-transparent px-2.5 text-xs font-medium text-[var(--ff-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)]';

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hrs = Math.round(minutes / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function planLabel(plan: string | null): string {
  switch (plan) {
    case 'pro':
      return 'Pro';
    case 'business':
      return 'Business';
    default:
      return 'Pro';
  }
}

export function DomainsClient() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [docOptions, setDocOptions] = useState<DocumentOption[]>([]);
  const [hostname, setHostname] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimit | null>(null);
  const [instructions, setInstructions] = useState<DnsRecordInstruction[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const hostnameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/v1/domains', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setState({ kind: 'error', message: body?.error?.message ?? `Request failed (${res.status})` });
        return;
      }
      const body = (await res.json()) as { data: CustomDomain[] };
      setState({ kind: 'ready', domains: body.data });
    } catch {
      setState({ kind: 'error', message: 'Network error while loading domains.' });
    }
  }, []);

  // Published documents for the attach target (T07 documents list endpoint,
  // merged at integration). Empty page → the manual documentId input keeps the
  // flow usable.
  useEffect(() => {
    fetch('/api/v1/documents?limit=50', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: Array<Record<string, unknown>> } | null) => {
        const options = (body?.data ?? [])
          .filter((d): d is { id: string; title: string } => typeof d.id === 'string')
          .map((d) => ({ id: d.id, title: typeof d.title === 'string' ? d.title : d.id }));
        setDocOptions(options);
      })
      .catch(() => setDocOptions([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    setPlanLimit(null);
    setInstructions(null);
    try {
      const res = await fetch('/api/v1/domains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostname: hostname.trim(), documentId: documentId.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; code?: string; details?: { path?: string; message: string }[] };
        } | null;
        if (res.status === 402 && body?.error) {
          const plan = body.error.details?.find((d) => d.path === 'requiredPlan')?.message ?? null;
          setPlanLimit({ capability: 'customDomains', requiredPlan: plan });
        } else {
          setAddError(body?.error?.message ?? `Could not add domain (${res.status})`);
        }
        return;
      }
      const body = (await res.json()) as {
        domain: CustomDomain;
        instructions: { records: DnsRecordInstruction[] };
      };
      setInstructions(body.instructions.records);
      setHostname('');
      setDocumentId('');
      hostnameRef.current?.focus();
      await load();
    } catch {
      setAddError('Network error while adding the domain.');
    } finally {
      setAdding(false);
    }
  };

  const verify = async (domain: CustomDomain) => {
    setVerifyingId(domain.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(domain.id)}/verify`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => null)) as
        | { verified?: boolean; domain?: CustomDomain; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(body?.error?.message ?? `Verification check failed (${res.status})`);
        return;
      }
      if (body?.verified) {
        setNotice(`${domain.hostname} verified — traffic for this hostname is now routed.`);
      } else {
        setError(
          `${domain.hostname} is not proven yet — publish the TXT record (and CNAME), then retry. The domain stays unrouted until it verifies.`,
        );
      }
      await load();
    } catch {
      setError('Network error during verification.');
    } finally {
      setVerifyingId(null);
    }
  };

  const remove = async (domain: CustomDomain) => {
    if (!window.confirm(`Remove "${domain.hostname}"? Traffic for this hostname stops immediately.`)) {
      return;
    }
    setBusyId(domain.id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/domains?id=${encodeURIComponent(domain.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? `Remove failed (${res.status})`);
        return;
      }
      setNotice(`${domain.hostname} removed — routing entry deleted and caches purged.`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value).catch(() => {});
    setNotice(`Copied: ${value}`);
  };

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="ff-banner ff-banner-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ff-banner ff-banner-success">
          {notice}
        </p>
      )}
      {planLimit && (
        <div
          role="alert"
          className="rounded-[var(--ff-radius)] border border-[color-mix(in_srgb,var(--ff-primary)_40%,var(--ff-border))] bg-[color-mix(in_srgb,var(--ff-primary)_8%,var(--ff-card))] p-4 text-sm"
        >
          <p className="font-medium">Custom domains are a plan limit</p>
          <p className="mt-1">
            The <code className="rounded bg-[var(--ff-bg)] px-1">{planLimit.capability}</code> quota is used up on this
            plan. Upgrade to {planLabel(planLimit.requiredPlan)} to attach another hostname.
          </p>
        </div>
      )}

      {instructions && (
        <section
          aria-live="polite"
          aria-label="DNS records to publish"
          className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-5"
        >
          <h2 className="text-sm font-semibold text-[var(--ff-fg)]">Publish these DNS records, then verify</h2>
          <ul className="mt-3 space-y-2">
            {instructions.map((record) => (
              <li
                key={`${record.type}-${record.name}`}
                className="rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="ff-badge ff-badge--accent font-mono text-[11px]">{record.type}</span>
                  <code className="break-all font-mono text-xs text-[var(--ff-fg)]">{record.name}</code>
                  <span aria-hidden className="text-[var(--ff-muted)]">→</span>
                  <code className="break-all font-mono text-xs text-[var(--ff-muted)]">{record.value}</code>
                  <button
                    type="button"
                    onClick={() => void copy(record.value)}
                    className={`${BTN_SECONDARY_SM} ml-auto`}
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[var(--ff-muted)]">{record.purpose}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-[var(--ff-muted)]">
            Apex domains (e.g. <code className="font-mono">example.com</code>) usually cannot CNAME — use your provider&apos;s
            ALIAS/ANAME record for the CNAME row instead. DNS can take a few minutes to propagate.
          </p>
        </section>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-5"
        aria-label="Add a custom domain"
      >
        <h2 className="text-sm font-semibold text-[var(--ff-fg)]">Add a domain</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="domain-hostname" className="block text-sm font-medium text-[var(--ff-fg)]">
              Hostname
            </label>
            <input
              id="domain-hostname"
              ref={hostnameRef}
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              required
              placeholder="docs.example.com"
              autoComplete="off"
              className={`${INPUT} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="domain-document" className="block text-sm font-medium text-[var(--ff-fg)]">
              Serve document
            </label>
            {docOptions.length > 0 ? (
              <div className="relative mt-1">
                <select
                  id="domain-document"
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  required
                  className={`${INPUT} cursor-pointer appearance-none pr-9`}
                >
                  <option value="">— choose a document —</option>
                  {docOptions.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.title}
                    </option>
                  ))}
                </select>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ff-muted)]"
                >
                  <path
                    d="m5 7.5 5 5 5-5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            ) : (
              <input
                id="domain-document"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                required
                placeholder="doc_… id of a published document"
                autoComplete="off"
                className={`${INPUT} mt-1`}
              />
            )}
            <p className="mt-1 text-[11px] text-[var(--ff-muted)]">
              {docOptions.length === 0
                ? 'No documents listed yet — enter a document id from this workspace manually.'
                : 'Only documents in this workspace can be attached.'}
            </p>
          </div>
        </div>
        {addError && (
          <p role="alert" className="ff-banner ff-banner-error mt-3">
            {addError}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={adding || hostname.trim().length === 0 || documentId.trim().length === 0}
            className={BTN_PRIMARY}
          >
            {adding ? 'Adding…' : 'Add domain'}
          </button>
        </div>
      </form>

      {state.kind === 'loading' && (
        <div aria-hidden className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)]"
            />
          ))}
        </div>
      )}

      {state.kind === 'error' && (
        <div className="ff-banner ff-banner-error">
          <p className="font-medium">Domains could not be loaded.</p>
          <p className="mt-1">{state.message}</p>
          <button type="button" onClick={() => void load()} className={BTN_RETRY}>
            Retry
          </button>
        </div>
      )}

      {state.kind === 'ready' && state.domains.length === 0 && (
        <div className="ff-empty">
          <p className="m-0 text-sm font-medium text-[var(--ff-fg)]">No custom domains yet</p>
          <p className="m-0 max-w-sm text-sm leading-relaxed text-[var(--ff-muted)]">
            Add your first hostname above — publish the DNS records, verify, and your published
            document is served from your own URL over HTTPS.
          </p>
        </div>
      )}

      {state.kind === 'ready' && state.domains.length > 0 && (
        <ul className="divide-y divide-[var(--ff-border)] overflow-hidden rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)]">
          {state.domains.map((domain) => (
            <li key={domain.id} className="px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-[var(--ff-fg)]">
                    <code className="truncate font-mono">{domain.hostname}</code>
                    {domain.status === 'verified' ? (
                      <span className="ff-badge ff-badge--positive">verified</span>
                    ) : (
                      <span className="ff-badge ff-badge--muted">pending — not routed</span>
                    )}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-[var(--ff-muted)]">
                    Last checked {relativeTime(domain.lastCheckedAt)}
                    {domain.verifiedAt ? ` · verified ${relativeTime(domain.verifiedAt)}` : ''}
                    {' · provisioned via '}
                    {domain.provisionMode === 'cloudflare' ? 'Cloudflare for SaaS' : 'manual DNS'}
                  </p>
                  {domain.lastError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{domain.lastError}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={verifyingId === domain.id}
                    onClick={() => void verify(domain)}
                    className={BTN_SECONDARY_SM}
                  >
                    {verifyingId === domain.id
                      ? 'Checking…'
                      : domain.status === 'verified'
                        ? 'Re-check DNS'
                        : 'Verify now'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === domain.id}
                    onClick={() => void remove(domain)}
                    className={BTN_DESTRUCTIVE_SM}
                  >
                    {busyId === domain.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
              {domain.status !== 'verified' && (
                <dl className="mt-3 grid gap-1 rounded-[calc(var(--ff-radius)*0.66)] bg-[var(--ff-bg)] px-3 py-2 font-mono text-[11px] text-[var(--ff-muted)]">
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0">TXT</dt>
                    <dd className="m-0 break-all">
                      {domain.txtName} = {domain.txtValue}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0">CNAME</dt>
                    <dd className="m-0 break-all">
                      {domain.hostname} → {domain.cnameTarget}
                    </dd>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
