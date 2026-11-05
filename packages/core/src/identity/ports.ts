// Identity module ports (spec §3/§6). The identity module owns these
// contracts; concrete Drizzle implementations live in @formforge/db
// (packages/db/src/repositories/**) and are wired in the web composition root.
// SPEC-NOTE: repositories are injected as interfaces (ports/adapters) so that
// identity services have no compile-time dependency on @formforge/db internals
// while T02 lands the schema in parallel; the composition root enforces the
// structural match at typecheck time.
import type { Mailer } from "../integrations/mailer";
import type { AuthEmailRenderer, AuthTokenKind, AuthTokenRecord } from "./tokens";
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
export type {
  AuthTokenKind,
  AuthTokenRecord,
  RenderedAuthEmail,
} from "./tokens";

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Password reset: replace the stored hash (null = OAuth-only account). */
  setPasswordHash(id: string, passwordHash: string | null): Promise<void>;
  /** Email verification: set the verified-at column (ticket #5). */
  markEmailVerified(id: string, verifiedAt: Date): Promise<void>;
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
  /** Revoke every session for a user (password reset → sign out everywhere). */
  deleteForUser(userId: string): Promise<number>;
}

/**
 * Single-use auth tokens (password reset + email verification, ticket #5).
 * Tokens are stored hashed; `consume` is a compare-and-set on
 * `consumed_at IS NULL` so exactly one of two concurrent uses wins.
 */
export interface AuthTokenRepository {
  create(token: AuthTokenRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<AuthTokenRecord | null>;
  /** Atomic single-use: returns true only for the first consume. */
  consumeByTokenHash(tokenHash: string, consumedAt: Date): Promise<boolean>;
  /** Invalidate outstanding tokens of a kind (e.g. re-requested reset). */
  deleteUnconsumedByUser(userId: string, kind: AuthTokenKind, at: Date): Promise<number>;
}

export interface IdentityRepositories {
  users: UserRepository;
  workspaces: WorkspaceRepository;
  memberships: MembershipRepository;
  registration: RegistrationRepository;
  sessions: SessionRepository;
  authTokens: AuthTokenRepository;
}

export type IdentityDeps = {
  repos: IdentityRepositories;
  hasher: PasswordHasher;
  /**
   * Transport for auth emails (reset/verify). Required by the recovery
   * services; optional on the type so flows that never send mail can omit it.
   */
  mailer?: Mailer;
  /** Email body renderer — web overrides the core fallback with React templates. */
  emails?: AuthEmailRenderer;
  /** Base URL used to build the links inside auth emails (e.g. https://app.dev). */
  appOrigin?: string;
};

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, storedHash: string): Promise<boolean>;
}
