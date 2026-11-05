'use server';

// apps/web/app/(app)/settings/billing/_lib/actions.ts
// Server actions for the billing settings page (the ONLY surface allowed to
// offer upgrades — spec §13: "Never put upgrade buttons inside editing
// surfaces"). Both actions go through the billing service, whose Stripe
// gateway is injected by _lib/billing-server.ts — no direct Stripe calls here.
//
// INTEGRATION-DEBT(T03): ctx.actor/requestId are placeholders until sessions
// land; the workspace id resolves the same way as the page snapshot.

import { redirect } from 'next/navigation';
import { isPaidPlan, type Ctx } from '@formforge/core/billing';
import { getBilling } from '../../../../api/webhooks/stripe/_lib/billing-server';
import { resolveWorkspaceId } from './billing-server';

function devCtx(): Ctx {
  return {
    workspaceId: resolveWorkspaceId(),
    actor: { type: 'user', id: '00000000-0000-7000-8000-000000000001' },
    requestId: crypto.randomUUID(),
    now: () => new Date(),
  };
}

const FLASH_BASE = '/settings/billing';

function flashError(code: string): never {
  redirect(`${FLASH_BASE}?error=${encodeURIComponent(code)}`);
}

/** "Upgrade to Pro/Business" → Stripe Checkout → back with ?checkout=… */
export async function startCheckoutAction(formData: FormData): Promise<void> {
  const raw = String(formData.get('plan') ?? '');
  if (!isPaidPlan(raw)) flashError('VALIDATION');

  let url: string;
  try {
    const result = await getBilling().startCheckout(devCtx(), { plan: raw });
    if (!result.ok) flashError(result.error.code);
    url = result.value.url;
  } catch {
    // Store unreachable (T02 migrations pending) or gateway network failure.
    flashError('INTERNAL');
  }
  redirect(url);
}

/** "Manage billing" → Stripe Customer Portal → back with ?portal=returned. */
export async function openPortalAction(): Promise<void> {
  let url: string;
  try {
    const result = await getBilling().createPortalSession(devCtx(), {});
    if (!result.ok) flashError(result.error.code);
    url = result.value.url;
  } catch {
    flashError('INTERNAL');
  }
  redirect(url);
}
