// @formforge/db — repositories barrel (ticket #3). Imported as
// `@formforge/db/repositories` by the web composition root.
//
// INTEGRATION-DEBT: awaiting T02 — getDb() is re-exported from ../bridge.ts
// until T02 ships the real client module; then drop this re-export and import
// the client from its canonical location.
//
// SPEC-NOTE: the return type is intentionally inferred — db does not depend on
// @formforge/core; the composition root (apps/web/lib/auth/container.ts)
// assigns this object to the `IdentityRepositories` port, so any structural
// drift fails typecheck there.
import type { Db } from "../bridge";
import { getDb } from "../bridge";
import {
  DrizzleMembershipRepository,
  DrizzleRegistrationRepository,
  DrizzleUserRepository,
  DrizzleWorkspaceRepository,
} from "./identity";
import { DrizzleSessionRepository } from "./sessions";
import { DrizzleAuthTokenRepository } from "./auth-tokens";

export { getDb } from "../bridge";
export type { Db } from "../bridge";
export {
  DrizzleMembershipRepository,
  DrizzleRegistrationRepository,
  DrizzleUserRepository,
  DrizzleWorkspaceRepository,
} from "./identity";
export { DrizzleSessionRepository } from "./sessions";
export { DrizzleAuthTokenRepository } from "./auth-tokens";

export function createDrizzleRepositories(db: Db = getDb()) {
  return {
    users: new DrizzleUserRepository(db),
    workspaces: new DrizzleWorkspaceRepository(db),
    memberships: new DrizzleMembershipRepository(db),
    registration: new DrizzleRegistrationRepository(db),
    sessions: new DrizzleSessionRepository(db),
    authTokens: new DrizzleAuthTokenRepository(db),
  };
}
// T02's tenancy repository (users/workspaces/memberships/apiTokens + RLS-ready
// Ctx-scoped functions) — kept alongside the auth-session repo above. Selective
// export: its DTO type names intentionally mirror identity.ts's.
export { createIdentityRepositories, type IdentityRepositories } from "./access.ts";
