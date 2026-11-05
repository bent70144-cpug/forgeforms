// Composition root for the identity module (spec §3: repositories live in
// @formforge/db, identity services in @formforge/core; they meet here).
// Lazy singleton so importing this module never requires DATABASE_URL —
// that keeps `next build` (which evaluates modules but runs no actions)
// green in environments without a database.
import {
  ScryptPasswordHasher,
  type IdentityDeps,
} from "@formforge/core/identity";
import { createDrizzleRepositories, getDb } from "@formforge/db/repositories";

let deps: IdentityDeps | undefined;

export function getIdentityDeps(): IdentityDeps {
  if (!deps) {
    deps = {
      repos: createDrizzleRepositories(getDb()),
      // SPEC-NOTE: scrypt for now — swap for argon2id here when the native
      // toolchain is available (PasswordHasher interface is the seam).
      hasher: new ScryptPasswordHasher(),
    };
  }
  return deps;
}
