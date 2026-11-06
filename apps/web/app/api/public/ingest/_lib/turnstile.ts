// apps/web/app/api/public/ingest/_lib/turnstile.ts
// Cloudflare Turnstile verification (spec §10.3: verify when document captcha
// is on). The stub accept-all verifier is used in dev/tests when
// TURNSTILE_SECRET_KEY is not configured.
//
// NOTE (untested here): the real verifier performs network I/O and is not
// covered by the vitest suite.

import type { TurnstileVerifier } from "@formforge/core/submissions";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function createRealTurnstileVerifier(secret: string): TurnstileVerifier {
  return {
    async verify(token: string | undefined, remoteIp?: string): Promise<boolean> {
      if (!token) return false;
      try {
        const body = new URLSearchParams({ secret, response: token });
        if (remoteIp) body.set("remoteip", remoteIp);
        const res = await fetch(SITEVERIFY_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { success?: boolean };
        return data.success === true;
      } catch {
        return false;
      }
    },
  };
}
