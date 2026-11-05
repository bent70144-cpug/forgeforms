// In-memory fakes for the identity ports — unit-test doubles that mirror the
// Drizzle repositories' semantics, including Postgres unique-violation errors
// (SQLSTATE 23505) so services can prove their CONFLICT mapping.
import type {
  IdentityRepositories,
  MembershipRepository,
  MembershipRole,
  PasswordHasher,
  RegistrationRepository,
  SessionRepository,
  UserRepository,
  WorkspaceRepository,
} from "./ports";
import type {
  MembershipRecord,
  SessionRecord,
  UserRecord,
  WorkspaceRecord,
} from "./types";
import type { Ctx } from "../bridge";
import { ScryptPasswordHasher } from "./password";
import { preAuthCtx } from "./service";

export class UniqueConstraintError extends Error {
  readonly code = "23505";
  constructor(constraint: string) {
    super(`duplicate key value violates unique constraint "${constraint}"`);
    this.name = "UniqueConstraintError";
  }
}

export class InMemoryIdentityRepositories implements IdentityRepositories {
  readonly usersByEmail = new Map<string, UserRecord>();
  readonly usersById = new Map<string, UserRecord>();
  readonly workspacesById = new Map<string, WorkspaceRecord>();
  readonly workspacesBySlug = new Map<string, WorkspaceRecord>();
  readonly membershipRows: MembershipRecord[] = [];
  readonly sessionsByTokenHash = new Map<string, SessionRecord>();
  readonly registrationCalls: Array<{
    user: UserRecord;
    workspace: WorkspaceRecord;
    membership: MembershipRecord;
  }> = [];
  readonly touchedSessionIds: string[] = [];

  users: UserRepository = {
    findByEmail: async (email) => this.usersByEmail.get(email) ?? null,
    findById: async (id) => this.usersById.get(id) ?? null,
  };

  workspaces: WorkspaceRepository = {
    findBySlug: async (slug) => this.workspacesBySlug.get(slug) ?? null,
    findById: async (id) => this.workspacesById.get(id) ?? null,
  };

  memberships: MembershipRepository = {
    listForUser: async (userId) =>
      this.membershipRows
        .filter((m) => m.userId === userId)
        .map((m) => {
          const workspace = this.workspacesById.get(m.workspaceId);
          if (!workspace) throw new Error(`membership references missing workspace ${m.workspaceId}`);
          return { workspace, role: m.role as MembershipRole };
        }),
  };

  registration: RegistrationRepository = {
    // Mirrors a single INSERT..RETURNING transaction on users/workspaces/memberships.
    createAccount: async ({ user, workspace, membership }) => {
      this.registrationCalls.push({ user, workspace, membership });
      if (this.usersByEmail.has(user.email)) throw new UniqueConstraintError("users_email_key");
      if (this.workspacesBySlug.has(workspace.slug)) throw new UniqueConstraintError("workspaces_slug_key");
      this.usersByEmail.set(user.email, user);
      this.usersById.set(user.id, user);
      this.workspacesBySlug.set(workspace.slug, workspace);
      this.workspacesById.set(workspace.id, workspace);
      this.membershipRows.push({ ...membership });
    },
  };

  sessions: SessionRepository = {
    create: async (session) => {
      this.sessionsByTokenHash.set(session.tokenHash, { ...session });
    },
    findWithUserByTokenHash: async (tokenHash) => {
      const session = this.sessionsByTokenHash.get(tokenHash);
      if (!session) return null;
      const user = this.usersById.get(session.userId);
      if (!user) return null;
      return { session: { ...session }, user: { ...user } };
    },
    touch: async (id, expiresAt) => {
      this.touchedSessionIds.push(id);
      for (const [hash, session] of this.sessionsByTokenHash) {
        if (session.id === id) this.sessionsByTokenHash.set(hash, { ...session, expiresAt });
      }
    },
    deleteByTokenHash: async (tokenHash) => this.sessionsByTokenHash.delete(tokenHash),
  };
}

export type TestHarness = {
  repos: InMemoryIdentityRepositories;
  hasher: PasswordHasher;
  ctx: Ctx;
  clock: {
    now: () => Date;
    advanceMs: (ms: number) => void;
    set: (date: Date) => void;
  };
};

export function makeTestHarness(options?: { startAt?: Date }): TestHarness {
  const repos = new InMemoryIdentityRepositories();
  const hasher = new ScryptPasswordHasher();
  let current = options?.startAt ? new Date(options.startAt) : new Date("2026-01-01T00:00:00.000Z");
  const clock = {
    now: () => new Date(current),
    advanceMs: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
    set: (date: Date) => {
      current = new Date(date.getTime());
    },
  };
  const ctx: Ctx = {
    ...preAuthCtx("req_test"),
    now: () => clock.now(),
  };
  return { repos, hasher, ctx, clock };
}
