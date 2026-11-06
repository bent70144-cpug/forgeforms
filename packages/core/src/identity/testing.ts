// In-memory fakes for the identity ports — unit-test doubles that mirror the
// Drizzle repositories' semantics, including Postgres unique-violation errors
// (SQLSTATE 23505) so services can prove their CONFLICT mapping.
import type {
  AuthTokenRepository,
  IdentityRepositories,
  MembershipRepository,
  MembershipRole,
  PasswordHasher,
  RegistrationRepository,
  SessionRepository,
  UserRepository,
  WorkspaceRepository,
} from "./ports";
import type { MailMessage, Mailer, MailSendResult } from "../integrations/mailer";
import type { AuthTokenRecord } from "./tokens";
import type {
  MembershipRecord,
  SessionRecord,
  UserRecord,
  WorkspaceRecord,
} from "./types";
import { type Ctx } from "../shared/ctx.ts";
import { AppError } from "../shared/errors.ts";
import { ok, type Result } from "../shared/result.ts";
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
  readonly authTokensByHash = new Map<string, AuthTokenRecord>();
  readonly registrationCalls: Array<{
    user: UserRecord;
    workspace: WorkspaceRecord;
    membership: MembershipRecord;
  }> = [];
  readonly touchedSessionIds: string[] = [];

  users: UserRepository = {
    findByEmail: async (email) => this.usersByEmail.get(email) ?? null,
    findById: async (id) => this.usersById.get(id) ?? null,
    setPasswordHash: async (id, passwordHash) => {
      const user = this.usersById.get(id);
      if (!user) throw new Error(`setPasswordHash: unknown user ${id}`);
      const updated = { ...user, passwordHash };
      this.usersById.set(id, updated);
      this.usersByEmail.set(updated.email, updated);
    },
    markEmailVerified: async (id, verifiedAt) => {
      const user = this.usersById.get(id);
      if (!user) throw new Error(`markEmailVerified: unknown user ${id}`);
      const updated = { ...user, emailVerifiedAt: verifiedAt };
      this.usersById.set(id, updated);
      this.usersByEmail.set(updated.email, updated);
    },
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
    deleteForUser: async (userId) => {
      let deleted = 0;
      for (const [hash, session] of [...this.sessionsByTokenHash]) {
        if (session.userId === userId) {
          this.sessionsByTokenHash.delete(hash);
          deleted += 1;
        }
      }
      return deleted;
    },
  };

  authTokens: AuthTokenRepository = {
    create: async (token) => {
      this.authTokensByHash.set(token.tokenHash, { ...token });
    },
    findByTokenHash: async (tokenHash) => {
      const token = this.authTokensByHash.get(tokenHash);
      return token ? { ...token } : null;
    },
    // Mirrors UPDATE ... SET consumed_at WHERE token_hash = $1 AND consumed_at IS NULL.
    consumeByTokenHash: async (tokenHash, consumedAt) => {
      const token = this.authTokensByHash.get(tokenHash);
      if (!token || token.consumedAt !== null) return false;
      this.authTokensByHash.set(tokenHash, { ...token, consumedAt });
      return true;
    },
    deleteUnconsumedByUser: async (userId, kind) => {
      let deleted = 0;
      for (const [hash, token] of [...this.authTokensByHash]) {
        if (token.userId === userId && token.kind === kind && token.consumedAt === null) {
          this.authTokensByHash.delete(hash);
          deleted += 1;
        }
      }
      return deleted;
    },
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

// --- mailer fake -------------------------------------------------------------

export type FakeMailer = Mailer & {
  /** Messages captured in send order. */
  readonly sent: MailMessage[];
  /** Pre-configured failures (shifted per send). */
  failNextWith: (error: AppError) => void;
};

/** Capturing mailer double for recovery-flow tests (no network, no console). */
export function makeFakeMailer(): FakeMailer {
  const sent: MailMessage[] = [];
  const failures: AppError[] = [];
  return {
    sent,
    failNextWith(error: AppError) {
      failures.push(error);
    },
    async send(message: MailMessage): Promise<Result<MailSendResult, AppError>> {
      const failure = failures.shift();
      if (failure) return { ok: false, error: failure };
      sent.push({ ...message });
      return ok({ id: `fake-${sent.length}` });
    },
  };
}
