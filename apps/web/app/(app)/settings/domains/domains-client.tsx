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

  // Published documents for the attach target. INTEGRATION-DEBT (T07): the
  // documents list endpoint answers an empty page until T07 lands; the manual
  // documentId input keeps the flow usable meanwhile.
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
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {planLimit && (
        <div role="alert" className="rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <p className="font-medium">Custom domains are a plan limit</p>
          <p className="mt-1">
            The <code className="rounded bg-white px-1">{planLimit.capability}</code> quota is used up on this
            plan. Upgrade to {planLabel(planLimit.requiredPlan)} to attach another hostname.
          </p>
        </div>
      )}

      {instructions && (
        <section
          aria-live="polite"
          aria-label="DNS records to publish"
          className="rounded-md border border-sky-300 bg-sky-50 px-5 py-4"
        >
          <h2 className="text-sm font-semibold text-sky-900">Publish these DNS records, then verify</h2>
          <ul className="mt-3 space-y-2">
            {instructions.map((record) => (
              <li key={`${record.type}-${record.name}`} className="rounded bg-white px-3 py-2 ring-1 ring-sky-200">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-sky-900">
                    {record.type}
                  </span>
                  <code className="break-all font-mono text-xs text-slate-900">{record.name}</code>
                  <span aria-hidden className="text-slate-400">→</span>
                  <code className="break-all font-mono text-xs text-slate-700">{record.value}</code>
                  <button
                    type="button"
                    onClick={() => void copy(record.value)}
                    className="ml-auto rounded border border-sky-300 px-2 py-0.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{record.purpose}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-sky-900">
            Apex domains (e.g. <code>example.com</code>) usually cannot CNAME — use your provider&apos;s
            ALIAS/ANAME record for the CNAME row instead. DNS can take a few minutes to propagate.
          </p>
        </section>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        className="rounded-md border border-slate-200 bg-white p-5"
        aria-label="Add a custom domain"
      >
        <h2 className="text-sm font-semibold text-slate-900">Add a domain</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="domain-hostname" className="block text-sm font-medium text-slate-700">
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
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="domain-document" className="block text-sm font-medium text-slate-700">
              Serve document
            </label>
            {docOptions.length > 0 ? (
              <select
                id="domain-document"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              >
                <option value="">— choose a document —</option>
                {docOptions.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="domain-document"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                required
                placeholder="doc_… id of a published document"
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              {docOptions.length === 0
                ? 'The document picker fills in once published documents are listed here (T07).'
                : 'Only documents in this workspace can be attached.'}
            </p>
          </div>
        </div>
        {addError && (
          <p role="alert" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {addError}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={adding || hostname.trim().length === 0 || documentId.trim().length === 0}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add domain'}
          </button>
        </div>
      </form>

      {state.kind === 'loading' && (
        <div aria-hidden className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      )}

      {state.kind === 'error' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Domains could not be loaded.</p>
          <p className="mt-1">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded border border-amber-300 px-3 py-1.5 text-xs font-medium hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}

      {state.kind === 'ready' && state.domains.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-300 px-6 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">No custom domains yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Add your first hostname above — publish the DNS records, verify, and your published
            document is served from your own URL over HTTPS.
          </p>
        </div>
      )}

      {state.kind === 'ready' && state.domains.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {state.domains.map((domain) => (
            <li key={domain.id} className="px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    <code className="truncate font-mono">{domain.hostname}</code>
                    {domain.status === 'verified' ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                        verified
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        pending — not routed
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Last checked {relativeTime(domain.lastCheckedAt)}
                    {domain.verifiedAt ? ` · verified ${relativeTime(domain.verifiedAt)}` : ''}
                    {' · provisioned via '}
                    {domain.provisionMode === 'cloudflare' ? 'Cloudflare for SaaS' : 'manual DNS'}
                  </p>
                  {domain.lastError && (
                    <p className="mt-1 text-xs text-amber-700">{domain.lastError}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={verifyingId === domain.id}
                    onClick={() => void verify(domain)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
                    className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {busyId === domain.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
              {domain.status !== 'verified' && (
                <dl className="mt-3 grid gap-1 rounded bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600">
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-slate-400">TXT</dt>
                    <dd className="break-all">
                      {domain.txtName} = {domain.txtValue}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-slate-400">CNAME</dt>
                    <dd className="break-all">
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
