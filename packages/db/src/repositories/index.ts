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
import type { Db } from "../bridge.js";
import { getDb } from "../bridge.js";
import {
  DrizzleMembershipRepository,
  DrizzleRegistrationRepository,
  DrizzleUserRepository,
  DrizzleWorkspaceRepository,
} from "./identity.js";
import { DrizzleSessionRepository } from "./sessions.js";

export { getDb } from "../bridge.js";
export type { Db } from "../bridge.js";
export {
  DrizzleMembershipRepository,
  DrizzleRegistrationRepository,
  DrizzleUserRepository,
  DrizzleWorkspaceRepository,
} from "./identity.js";
export { DrizzleSessionRepository } from "./sessions.js";

export function createDrizzleRepositories(db: Db = getDb()) {
  return {
    users: new DrizzleUserRepository(db),
    workspaces: new DrizzleWorkspaceRepository(db),
    memberships: new DrizzleMembershipRepository(db),
    registration: new DrizzleRegistrationRepository(db),
    sessions: new DrizzleSessionRepository(db),
  };
}
