// Identity data records — camelCase TS fields (spec §4 naming); the snake_case
// DB column mapping lives in the Drizzle repositories (@formforge/db).
// Mirrors spec §6 tables: users, workspaces, memberships (+ sessions for the
// DB-backed session store required by ticket #3).

export type MembershipRole = "owner" | "admin" | "editor" | "viewer";
export type WorkspacePlan = "free" | "pro" | "business";

export type UserRecord = {
  id: string;
  /** Stored lowercase; DB column is citext (spec §6) — normalization happens here too. */
  email: string;
  name: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  plan: WorkspacePlan;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
};

export type MembershipRecord = {
  workspaceId: string;
  userId: string;
  role: MembershipRole;
};

export type SessionRecord = {
  id: string;
  userId: string;
  /** sha256 of the opaque session token — raw tokens never touch the DB. */
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};
