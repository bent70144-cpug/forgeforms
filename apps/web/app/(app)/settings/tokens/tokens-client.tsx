'use client';

// Token management UI (spec §14.1.8, issue #25): list, create (reveal ONCE),
// revoke. Security properties:
//  - the plaintext token exists ONLY in transient React state of the reveal
//    panel; it is never persisted (localStorage), never copied to any store,
//    and never sent anywhere except the single POST that created it;
//  - the list endpoint never returns plaintexts or hashes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_SCOPES } from '@formforge/schema/api';

interface TokenDto {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; tokens: TokenDto[] }
  | { kind: 'error'; message: string };

const SCOPE_HINTS: Record<string, string> = {
  'docs:read': 'List and read documents',
  'docs:write': 'Create and edit documents',
  'docs:publish': 'Publish and unpublish documents',
  'submissions:read': 'Read submissions and summaries',
};

// Shared control recipes — token-driven so they flip with dark mode.
const BTN_PRIMARY =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-transparent bg-[var(--ff-primary)] px-4 text-sm font-medium text-[var(--ff-primary-fg)] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-4 text-sm font-medium text-[var(--ff-fg)] transition-colors hover:border-[var(--ff-muted)] hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,var(--ff-card))] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY_SM =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-2.5 text-xs font-medium text-[var(--ff-fg)] transition-colors hover:border-[var(--ff-muted)] hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,var(--ff-card))] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_DESTRUCTIVE_SM =
  'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-red-300/50 bg-[var(--ff-card)] px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400/30 dark:text-red-400';
const BTN_RETRY =
  'mt-3 inline-flex h-8 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-current/40 bg-transparent px-2.5 text-xs font-medium text-[var(--ff-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)]';

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function TokensClient() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/v1/tokens', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        const message = body?.error?.message ?? `Request failed (${res.status})`;
        setState({ kind: 'error', message });
        return;
      }
      const body = (await res.json()) as { data: TokenDto[]; nextCursor: string | null };
      setState({ kind: 'ready', tokens: body.data });
    } catch {
      setState({ kind: 'error', message: 'Network error while loading tokens.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = useCallback(
    async (token: TokenDto) => {
      if (!window.confirm(`Revoke "${token.name}"? Any script using it will stop working immediately.`)) {
        return;
      }
      setBusyId(token.id);
      setError(null);
      try {
        const res = await fetch(`/api/v1/tokens?id=${encodeURIComponent(token.id)}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 204) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          setError(body?.error?.message ?? `Revoke failed (${res.status})`);
          return;
        }
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="ff-banner ff-banner-error">
          {error}
        </p>
      )}

      {revealed ? (
        <RevealOncePanel name={revealed.name} token={revealed.token} onDone={() => setRevealed(null)} />
      ) : (
        <div className="flex justify-end">
          <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY}>
            Create token
          </button>
        </div>
      )}

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
          <p className="font-medium">Tokens could not be loaded.</p>
          <p className="mt-1">{state.message}</p>
          <p className="mt-2">
            Sign-in (Auth.js) is being wired up by T03/T04 — until then this screen cannot manage
            tokens, though the token API itself is live.
          </p>
          <button type="button" onClick={() => void load()} className={BTN_RETRY}>
            Retry
          </button>
        </div>
      )}

      {state.kind === 'ready' && state.tokens.length === 0 && (
        <div className="ff-empty">
          <p className="m-0 text-sm font-medium text-[var(--ff-fg)]">No API tokens yet</p>
          <p className="m-0 max-w-sm text-sm leading-relaxed text-[var(--ff-muted)]">
            Create your first token, then call the API with{' '}
            <code className="rounded bg-[var(--ff-bg)] px-1 font-mono">Authorization: Bearer ff_…</code>. See{' '}
            <a
              href="/api/openapi.json"
              className="font-medium text-[var(--ff-primary)] underline underline-offset-2"
            >
              /api/openapi.json
            </a>
            .
          </p>
        </div>
      )}

      {state.kind === 'ready' && state.tokens.length > 0 && (
        <ul className="divide-y divide-[var(--ff-border)] overflow-hidden rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)]">
          {state.tokens.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--ff-fg)]">{token.name}</p>
                <p className="mt-0.5 text-xs tabular-nums text-[var(--ff-muted)]">
                  Created {relativeTime(token.createdAt)} · Last used {relativeTime(token.lastUsedAt)}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {token.scopes.map((scope) => (
                    <li
                      key={scope}
                      className="rounded-full border border-[var(--ff-border)] bg-[var(--ff-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ff-muted)]"
                      title={SCOPE_HINTS[scope] ?? scope}
                    >
                      {scope}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                disabled={busyId === token.id}
                onClick={() => void revoke(token)}
                className={BTN_DESTRUCTIVE_SM}
              >
                {busyId === token.id ? 'Revoking…' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateTokenModal
          onClose={() => setCreating(false)}
          onCreated={async (name, token) => {
            setCreating(false);
            setRevealed({ name, token });
            await load();
          }}
          onError={(message) => setError(message)}
        />
      )}
    </div>
  );
}

function RevealOncePanel({
  name,
  token,
  onDone,
}: {
  name: string;
  token: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    doneRef.current?.focus();
  }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(token).catch(() => {});
    setCopied(true);
  };

  return (
    <section
      aria-live="polite"
      aria-label="New token created — copy it now, it will not be shown again"
      className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-5"
    >
      <h2 className="text-base font-semibold text-[var(--ff-fg)] text-balance">
        “{name}” created — copy it now
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">
        This is the only time the full token is shown. FormForge stores only its SHA-256 hash and
        cannot recover it.
      </p>
      <div className="mt-3 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 break-all rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-3 py-2 font-mono text-sm text-[var(--ff-fg)]">
          {token}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center self-center rounded-[calc(var(--ff-radius)*0.66)] border border-transparent bg-[var(--ff-primary)] px-3 text-sm font-medium text-[var(--ff-primary-fg)] hover:brightness-110"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <button ref={doneRef} type="button" onClick={onDone} className={`${BTN_SECONDARY_SM} mt-3`}>
        Done — I saved it
      </button>
    </section>
  );
}

function CreateTokenModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (name: string, token: string) => void | Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['docs:read']);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleScope = (scope: string) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    onError(null);
    try {
      const res = await fetch('/api/v1/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string; details?: { message: string }[] } }
          | null;
        onError(body?.error?.message ?? `Could not create token (${res.status})`);
        return;
      }
      const body = (await res.json()) as { name: string; token: string };
      await onCreated(body.name, body.token);
    } catch {
      onError('Network error while creating the token.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-token-title"
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-lg rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-6 shadow-xl"
      >
        <h2 id="create-token-title" className="text-base font-semibold text-[var(--ff-fg)] text-balance">
          Create API token
        </h2>

        <div className="ff-field mt-4">
          <label htmlFor="token-name">Name</label>
          <input
            id="token-name"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            placeholder="e.g. CI pipeline"
          />
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-[var(--ff-fg)]">Scopes</legend>
          <div className="mt-2 space-y-2">
            {API_SCOPES.map((scope) => (
              <label key={scope} className="flex items-start gap-2 text-sm text-[var(--ff-fg)]">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="mt-0.5 h-4 w-4 accent-[var(--ff-primary)]"
                />
                <span>
                  <code className="font-mono text-xs">{scope}</code>
                  <span className="ml-2 text-xs text-[var(--ff-muted)]">{SCOPE_HINTS[scope] ?? ''}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="mt-4 text-xs text-[var(--ff-muted)]">
          Grant the minimum set you need. The plaintext token is shown once right after creation.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim().length === 0 || scopes.length === 0}
            className={BTN_PRIMARY}
          >
            {submitting ? 'Creating…' : 'Create token'}
          </button>
        </div>
      </form>
    </div>
  );
}
