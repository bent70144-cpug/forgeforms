// Composition root for the identity module (spec §3: repositories live in
// @formforge/db, identity services in @formforge/core; they meet here).
// Lazy singleton so importing this module never requires DATABASE_URL —
// that keeps `next build` (which evaluates modules but runs no actions)
// green in environments without a database.
import {
  ScryptPasswordHasher,
  type IdentityDeps,
} from "@formforge/core/identity";
import { createResendMailer, type Mailer } from "@formforge/core/integrations";
import { createDrizzleRepositories, getDb } from "@formforge/db/repositories";
import { reactAuthEmailRenderer } from "./emails";
import { createDevMailer } from "./dev-mail";

let deps: IdentityDeps | undefined;

/**
 * Mail transport selection (ticket #5): Resend when RESEND_API_KEY is set,
 * otherwise the dev transport — console logging plus an optional local file
 * outbox (DEV_MAIL_OUTBOX) so E2E tests can follow the emailed links.
 */
export function createAuthMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return createResendMailer({
      apiKey,
      from: process.env.RESEND_FROM ?? "FormForge <onboarding@resend.dev>",
    });
  }
  return createDevMailer({ outboxDir: process.env.DEV_MAIL_OUTBOX });
}

export function getIdentityDeps(): IdentityDeps {
  if (!deps) {
    deps = {
      repos: createDrizzleRepositories(getDb()),
      // SPEC-NOTE: scrypt for now — swap for argon2id here when the native
      // toolchain is available (PasswordHasher interface is the seam).
      hasher: new ScryptPasswordHasher(),
      // Ticket #5: auth email transport + React Email renderer.
      mailer: createAuthMailer(),
      emails: reactAuthEmailRenderer,
    };
  }
  return deps;
}

/**
 * IdentityDeps with the per-request app origin filled in (email links are
 * absolute). Container stays a lazy singleton; the origin varies per request.
 */
export async function getRequestIdentityDeps(origin: string): Promise<IdentityDeps> {
  return { ...getIdentityDeps(), appOrigin: origin };
}
