'use client';

// Token management UI (spec §14.1.8, issue #25): list, create (reveal ONCE),
// revoke. Security properties:
//  - the plaintext token exists ONLY in transient React state of the reveal
//    panel; it is never persisted (localStorage), never copied to any store,
//    and never sent anywhere except the single POST that created it;
//  - the list endpoint never returns plaintexts or hashes.
//
// Presentation notes: the create dialog and the remove confirmation use the
// shared Modal primitive (focus trap, Esc, backdrop, scroll lock come from the
// primitive — none are re-implemented here); the reveal panel renders ABOVE the
// persistent list header so the toolbar never jumps when it appears.

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_SCOPES } from '@formforge/schema/api';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icons';
import {
  BADGE_MUTED,
  BANNER_ERROR,
  BTN_DESTRUCTIVE_SM,
  BTN_GHOST_SM,
  BTN_PRIMARY,
  BTN_PRIMARY_SM,
  BTN_SECONDARY_SM,
} from '@/lib/ui';

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
        <p role="alert" className={BANNER_ERROR}>
          {error}
        </p>
      )}

      {revealed && (
        <RevealOncePanel name={revealed.name} token={revealed.token} onDone={() => setRevealed(null)} />
      )}

      {/* Persistent list header — stays put when the reveal panel appears. */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">
          Tokens
          {state.kind === 'ready' && state.tokens.length > 0 ? (
            <span className="ml-2 text-xs font-normal tabular-nums text-[var(--ff-muted)]">
              {state.tokens.length}
            </span>
          ) : null}
        </h2>
        <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY_SM}>
          <Icon name="plus" size={14} />
          Create token
        </button>
      </div>

      {state.kind === 'loading' && (
        <div aria-hidden className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="ff-skeleton" style={{ height: '4.5rem' }} />
          ))}
        </div>
      )}

      {state.kind === 'error' && (
        <div className={BANNER_ERROR}>
          <p className="font-medium">Tokens could not be loaded.</p>
          <p className="mt-1">{state.message}</p>
          <p className="mt-2">
            Sign-in with API tokens is available for workspace automation — if you were signed out,
            sign in again and retry.
          </p>
          <button type="button" onClick={() => void load()} className={`${BTN_SECONDARY_SM} mt-3`}>
            Retry
          </button>
        </div>
      )}

      {state.kind === 'ready' && state.tokens.length === 0 && (
        <EmptyState
          icon={<Icon name="key" size={20} />}
          title="No API tokens yet"
          description="Create your first token, then call the API with “Authorization: Bearer ff_…”. Tokens are scoped to this workspace."
          action={
            <>
              <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY}>
                Create your first token
              </button>
              <a
                href="/api/openapi.json"
                className={BTN_GHOST_SM}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="external" size={14} />
                API reference
              </a>
            </>
          }
        />
      )}

      {state.kind === 'ready' && state.tokens.length > 0 && (
        <ul className="ff-panel divide-y divide-[var(--ff-border)] overflow-hidden">
          {state.tokens.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--ff-fg)]">{token.name}</p>
                <p className="mt-0.5 text-xs tabular-nums text-[var(--ff-muted)]">
                  Created {relativeTime(token.createdAt)} · Last used {relativeTime(token.lastUsedAt)}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {token.scopes.map((scope) => (
                    <li
                      key={scope}
                      className={`${BADGE_MUTED} font-mono text-xs`}
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

      <CreateTokenModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (name, token) => {
          setCreating(false);
          setRevealed({ name, token });
          await load();
        }}
        onError={(message) => setError(message)}
      />
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
      className="ff-panel overflow-hidden"
    >
      <div aria-hidden="true" className="h-[3px] bg-[var(--ff-accent-soft)]" />
      <div className="p-5">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Icon name="alert" size={16} className="shrink-0 text-[var(--ff-warning)]" />
          <span className="font-medium">“{name}” created</span>
          <span className="text-[var(--ff-muted)]">— copy it now, you won’t see it again.</span>
        </p>
        <code
          className="mt-3 block select-all break-all rounded-[10px] border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_4%,var(--ff-bg))] p-3 font-mono text-[13px] text-[var(--ff-fg)]"
          data-testid="revealed-token"
        >
          {token}
        </code>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void copy()} className={BTN_PRIMARY_SM}>
            {copied ? (
              <>
                <Icon name="check" size={14} />
                Copied
              </>
            ) : (
              'Copy'
            )}
          </button>
          <button ref={doneRef} type="button" onClick={onDone} className={BTN_GHOST_SM}>
            Done — I saved it
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--ff-muted)]">
          FormForge stores only a SHA-256 hash of this token and cannot recover it.
        </p>
      </div>
    </section>
  );
}

function CreateTokenModal({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string, token: string) => void | Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['docs:read']);
  const [submitting, setSubmitting] = useState(false);

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
    <Modal
      open={open}
      onClose={onClose}
      title="Create API token"
      description="Tokens act on your behalf via the API."
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_GHOST_SM} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            form="create-token-form"
            disabled={submitting || name.trim().length === 0 || scopes.length === 0}
            className={BTN_PRIMARY_SM}
          >
            {submitting ? 'Creating…' : 'Create token'}
          </button>
        </>
      }
    >
      <form id="create-token-form" onSubmit={(e) => void submit(e)}>
        <div className="ff-field">
          <label htmlFor="token-name">Name</label>
          <input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            placeholder="e.g. CI pipeline"
          />
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-[var(--ff-fg)]">Scopes</legend>
          <div className="mt-2 divide-y divide-[var(--ff-border)] overflow-hidden rounded-xl border border-[var(--ff-border)]">
            {API_SCOPES.map((scope) => (
              <label key={scope} className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="h-4 w-4 shrink-0 rounded accent-[var(--ff-accent)]"
                />
                <span className="min-w-0">
                  <code className="font-mono text-sm text-[var(--ff-fg)]">{scope}</code>
                  <span className="block text-xs leading-relaxed text-[var(--ff-muted)]">
                    {SCOPE_HINTS[scope] ?? ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="mt-4 text-xs leading-relaxed text-[var(--ff-muted)]">
          Grant the minimum set you need. The plaintext token is shown once right after creation.
        </p>
      </form>
    </Modal>
  );
}
