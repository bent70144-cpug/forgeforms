// Identity module ports (spec §3/§6). The identity module owns these
// contracts; concrete Drizzle implementations live in @formforge/db
// (packages/db/src/repositories/**) and are wired in the web composition root.
// SPEC-NOTE: repositories are injected as interfaces (ports/adapters) so that
// identity services have no compile-time dependency on @formforge/db internals
// while T02 lands the schema in parallel; the composition root enforces the
// structural match at typecheck time.
import type {
  MembershipRecord,
  MembershipRole,
  SessionRecord,
  UserRecord,
  WorkspaceRecord,
} from "./types";

export type {
  MembershipRole,
  MembershipRecord,
  SessionRecord,
  UserRecord,
  WorkspacePlan,
  WorkspaceRecord,
} from "./types";

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export interface WorkspaceRepository {
  findBySlug(slug: string): Promise<WorkspaceRecord | null>;
  findById(id: string): Promise<WorkspaceRecord | null>;
}

export interface MembershipRepository {
  /** Workspaces the user belongs to, oldest first. */
  listForUser(userId: string): Promise<Array<{ workspace: WorkspaceRecord; role: MembershipRole }>>;
}

/**
 * Atomic signup write: user row + personal workspace + owner membership must
 * be created together or not at all (M1 acceptance). Implementations back this
 * with a single DB transaction and surface unique-constraint violations so the
 * service can map them to AppError("CONFLICT").
 */
export interface RegistrationRepository {
  createAccount(input: { user: UserRecord; workspace: WorkspaceRecord; membership: MembershipRecord }): Promise<void>;
}

export interface SessionRepository {
  create(session: SessionRecord): Promise<void>;
  findWithUserByTokenHash(tokenHash: string): Promise<{ session: SessionRecord; user: UserRecord } | null>;
  /** Sliding expiry: extend a session's expires_at. */
  touch(id: string, expiresAt: Date): Promise<void>;
  deleteByTokenHash(tokenHash: string): Promise<boolean>;
}

export interface IdentityRepositories {
  users: UserRepository;
  workspaces: WorkspaceRepository;
  memberships: MembershipRepository;
  registration: RegistrationRepository;
  sessions: SessionRepository;
}

export type IdentityDeps = {
  repos: IdentityRepositories;
  hasher: PasswordHasher;
};

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, storedHash: string): Promise<boolean>;
}
