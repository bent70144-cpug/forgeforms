'use client';

// Custom domains settings UI (issue #24, spec §14 settings, §13 quota UX).
// Flow mirrors the API: add (pending + DNS instructions) → verify (ownership
// check; unverified NEVER routes) → remove (unroute + cache purge). The 402
// PLAN_LIMIT response surfaces as an upgrade prompt HERE (spec §13: upgrade
// prompts live only in settings and the error response, never in editing
// surfaces).
//
// Presentation notes: DNS records render as definition rows with a copy action
// for BOTH name and value (aria-label'd, swap to a check when copied); the
// "Copied" announcement lives on a visually-hidden live region instead of the
// whole instructions region; removal goes through the shared Modal primitive
// instead of window.confirm.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CustomDomain, DnsRecordInstruction } from '@formforge/schema/api';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icons';
import {
  BADGE_ACCENT,
  BADGE_POSITIVE,
  BADGE_WARNING,
  BANNER_ERROR,
  BANNER_SUCCESS,
  BTN_DESTRUCTIVE_SM,
  BTN_GHOST_SM,
  BTN_PRIMARY,
  BTN_PRIMARY_SM,
  BTN_SECONDARY_SM,
  ICON_BTN,
} from '@/lib/ui';

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
  const [removeTarget, setRemoveTarget] = useState<CustomDomain | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
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

  // Published documents for the attach target. Empty list → the manual
  // documentId input keeps the flow usable.
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

  // Same underlying handler as before — the window.confirm gate was replaced
  // by the shared Modal (removeTarget state) without changing the request.
  const remove = async (domain: CustomDomain) => {
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
      setRemoveTarget(null);
    }
  };

  const copy = async (key: string, label: string, value: string) => {
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopiedKey(key);
    setCopyStatus(`Copied ${label}`);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1600);
  };

  const focusHostname = () => {
    hostnameRef.current?.focus();
    hostnameRef.current?.scrollIntoView({ block: 'center' });
  };

  return (
    <div className="space-y-6">
      {/* Quiet announcement slot for clipboard actions (kept out of the layout). */}
      <p aria-live="polite" role="status" className="sr-only">
        {copyStatus}
      </p>

      {error && (
        <p role="alert" className={BANNER_ERROR}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={BANNER_SUCCESS}>
          {notice}
        </p>
      )}

      {planLimit && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-4 rounded-[var(--ff-radius)] border border-[color-mix(in_srgb,var(--ff-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--ff-accent)_8%,var(--ff-card))] p-5"
        >
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--ff-accent)_12%,transparent)] text-[var(--ff-accent)]"
          >
            <Icon name="sparkles" size={18} />
          </span>
          <div className="min-w-[16rem] flex-1">
            <h2 className="text-base font-semibold">Custom domains are a plan limit</h2>
            <p className="mt-0.5 text-sm leading-relaxed text-[var(--ff-muted)]">
              The <code className="rounded bg-[var(--ff-bg)] px-1 font-mono">{planLimit.capability}</code>{' '}
              quota is used up on this plan. Upgrade to {planLabel(planLimit.requiredPlan)} to attach
              another hostname.
            </p>
          </div>
          <Link href="/settings/billing" className={`${BTN_PRIMARY_SM} shrink-0`}>
            Upgrade
          </Link>
        </div>
      )}

      {instructions && (
        <section aria-label="DNS records to publish" className="ff-panel p-5">
          <h2 className="text-base font-semibold">Publish these DNS records, then verify</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">
            Add the records below at your DNS provider, then press Verify on the domain. The hostname
            stays unrouted until ownership is confirmed.
          </p>
          <ul className="mt-4 space-y-2">
            {instructions.map((record) => {
              const rowKey = `${record.type}-${record.name}`;
              const nameKey = `${rowKey}:name`;
              const valueKey = `${rowKey}:value`;
              return (
                <li
                  key={rowKey}
                  className="rounded-[10px] border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_3%,var(--ff-bg))] px-3 py-2"
                >
                  <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                    <span className={`${BADGE_ACCENT} font-mono text-xs`}>{record.type}</span>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-[var(--ff-muted)]">
                        {record.name}
                      </p>
                      <p className="mt-0.5 break-all font-mono text-[13px] text-[var(--ff-fg)]">
                        {record.value}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Copy record name"
                        onClick={() => void copy(nameKey, 'record name', record.name)}
                        className={ICON_BTN}
                      >
                        <Icon name={copiedKey === nameKey ? 'check' : 'copy'} size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="Copy record value"
                        onClick={() => void copy(valueKey, 'record value', record.value)}
                        className={ICON_BTN}
                      >
                        <Icon name={copiedKey === valueKey ? 'check' : 'copy'} size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--ff-muted)]">
                    {record.purpose}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-[var(--ff-muted)]">
            Apex domains (e.g. <code className="font-mono">example.com</code>) usually cannot CNAME —
            use your provider’s ALIAS/ANAME record for the CNAME row instead. DNS can take a few
            minutes to propagate.
          </p>
        </section>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        className="ff-panel p-5"
        aria-label="Add a custom domain"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--ff-accent)_12%,transparent)] text-[var(--ff-accent)]"
          >
            <Icon name="globe" size={18} />
          </span>
          <div>
            <h2 className="text-base font-semibold">Add a domain</h2>
            <p className="text-xs text-[var(--ff-muted)]">
              Point a hostname you own at one of your published documents.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="ff-field">
            <label htmlFor="domain-hostname">Hostname</label>
            <input
              id="domain-hostname"
              ref={hostnameRef}
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              required
              placeholder="docs.example.com"
              autoComplete="off"
            />
            {/* balances the row: the Serve document column carries a helper
                line, so the left column gets one too — otherwise the grid
                leaves a dead gap under the Hostname input */}
            <p className="text-xs leading-relaxed text-[var(--ff-muted)]">
              Use a hostname you control — ownership is proven with a DNS record.
            </p>
          </div>
          <div className="ff-field">
            <label htmlFor="domain-document">Serve document</label>
            {docOptions.length > 0 ? (
              <div className="relative">
                <select
                  id="domain-document"
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  required
                  className="cursor-pointer appearance-none pr-9"
                >
                  <option value="">— choose a document —</option>
                  {docOptions.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.title}
                    </option>
                  ))}
                </select>
                <Icon
                  name="chevronDown"
                  size={16}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ff-muted)]"
                />
              </div>
            ) : (
              <input
                id="domain-document"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                required
                placeholder="doc_… id of a published document"
                autoComplete="off"
              />
            )}
            <p className="text-xs leading-relaxed text-[var(--ff-muted)]">
              {docOptions.length === 0
                ? 'No documents listed yet — enter a document id from this workspace manually.'
                : 'Only documents in this workspace can be attached.'}
            </p>
          </div>
        </div>
        {addError && (
          <p role="alert" className={`${BANNER_ERROR} mt-3`}>
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
        <div aria-hidden className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="ff-skeleton" style={{ height: '5.5rem' }} />
          ))}
        </div>
      )}

      {state.kind === 'error' && (
        <div className={BANNER_ERROR}>
          <p className="font-medium">Domains could not be loaded.</p>
          <p className="mt-1">{state.message}</p>
          <button type="button" onClick={() => void load()} className={`${BTN_SECONDARY_SM} mt-3`}>
            Retry
          </button>
        </div>
      )}

      {state.kind === 'ready' && state.domains.length === 0 && (
        <EmptyState
          icon={<Icon name="globe" size={20} />}
          title="No custom domains yet"
          description="Add your first hostname — publish the DNS records, verify, and your published document is served from your own URL over HTTPS."
          action={
            <button type="button" onClick={focusHostname} className={BTN_PRIMARY}>
              Add your first domain
            </button>
          }
        />
      )}

      {state.kind === 'ready' && state.domains.length > 0 && (
        <ul className="ff-panel divide-y divide-[var(--ff-border)] overflow-hidden">
          {state.domains.map((domain) => (
            <li key={domain.id} className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <code className="min-w-0 max-w-full truncate font-mono text-sm font-medium text-[var(--ff-fg)]">
                  {domain.hostname}
                </code>
                {domain.status === 'verified' ? (
                  <span className={BADGE_POSITIVE}>Verified</span>
                ) : (
                  <span className={BADGE_WARNING} title="Not routed until verified">
                    Pending
                  </span>
                )}
                <p className="min-w-0 text-xs tabular-nums text-[var(--ff-muted)]">
                  Added {relativeTime(domain.createdAt)} · Checked{' '}
                  {relativeTime(domain.lastCheckedAt)}
                  {domain.verifiedAt ? ` · Verified ${relativeTime(domain.verifiedAt)}` : ''}
                  {' · '}
                  {domain.provisionMode === 'cloudflare' ? 'Cloudflare for SaaS' : 'manual DNS'}
                </p>
                <div className="ml-auto flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={verifyingId === domain.id}
                    onClick={() => void verify(domain)}
                    className={BTN_SECONDARY_SM}
                  >
                    <Icon
                      name="refresh"
                      size={14}
                      className={verifyingId === domain.id ? 'ff-spin' : undefined}
                    />
                    {verifyingId === domain.id
                      ? 'Checking…'
                      : domain.status === 'verified'
                        ? 'Re-check DNS'
                        : 'Verify'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === domain.id}
                    onClick={() => setRemoveTarget(domain)}
                    className={BTN_DESTRUCTIVE_SM}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {domain.lastError && (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--ff-danger)]">
                  {domain.lastError}
                </p>
              )}
              {domain.status !== 'verified' && (
                <dl
                  className="mt-3 grid gap-1 rounded-[10px] border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_3%,var(--ff-bg))] px-3 py-2 font-mono text-xs text-[var(--ff-muted)]"
                  aria-label="DNS records for this domain"
                >
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 font-medium">TXT</dt>
                    <dd className="m-0 break-all">
                      {domain.txtName} = {domain.txtValue}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 font-medium">CNAME</dt>
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

      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="Remove domain?"
        description={
          removeTarget
            ? `${removeTarget.hostname} will stop serving immediately — its routing entry is deleted and caches are purged. You can add it again later.`
            : undefined
        }
        footer={
          <>
            <button
              type="button"
              className={BTN_GHOST_SM}
              onClick={() => setRemoveTarget(null)}
              disabled={busyId !== null}
            >
              Cancel
            </button>
            <button
              type="button"
              className={BTN_DESTRUCTIVE_SM}
              disabled={busyId !== null}
              onClick={() => {
                if (removeTarget) void remove(removeTarget);
              }}
            >
              {busyId !== null ? 'Removing…' : 'Remove domain'}
            </button>
          </>
        }
      />
    </div>
  );
}
