// Server-side wiring for the AI endpoints (draft + edit). This is the ONLY
// place that knows how to turn an HTTP request into an AI module call.
//
// INTEGRATION-DEBT (T27): awaiting T01 (auth/session), T02 (db client +
// repositories) and T23 (billing can()). Replace the marked pieces when
// those land:
//   1. resolveWorkspaceId  → derive { workspaceId, actor } from the session.
//   2. usage repo          → PgAiUsageRepo from @formforge/db (canonical
//      implementation already exists at
//      packages/db/src/repositories/ai-usage.ts; it is not importable yet
//      because packages/db has no subpath exports until T02 adds them, so
//      the two SQL statements are duplicated here on purpose).
//   3. can()               → billing.can(workspaceId, capability) (spec §13).
//   4. getPlan             → entitlements/workspace lookup from billing.
import { Pool } from "pg";
import { AnthropicMessagesProvider } from "@formforge/core/ai";
import type {
  AiModuleDeps,
  AiUsageRepo,
  CanFn,
  Ctx,
  Plan,
} from "@formforge/core/ai";

/** Spec §4 error shape: { error: { code, message, details } } + HTTP status. */
export type HttpError = {
  code: string;
  message: string;
  status: number;
  details?: unknown;
};

export type Wired<T> = { ok: true; value: T } | { ok: false; error: HttpError };

export function errorBody(error: HttpError): {
  error: { code: string; message: string; details?: unknown };
} {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}

/**
 * INTEGRATION-DEBT (T01): sessions do not exist yet, so the workspace and
 * actor come from trusted headers that the auth gate will own. Once T01
 * lands, replace the body of this function with session resolution and
 * requireRole("editor") — the header path must be deleted.
 */
export function resolveWorkspaceId(request: Request): Wired<string> {
  const workspaceId = request.headers.get("x-workspace-id");
  if (!workspaceId) {
    return {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Missing workspace context (session integration pending)",
        status: 401,
      },
    };
  }
  return { ok: true, value: workspaceId };
}

export function makeRequestCtx(request: Request, workspaceId: string): Ctx {
  return {
    workspaceId,
    // INTEGRATION-DEBT (T01): actor comes from the session; "unknown" until then.
    actor: { type: "user", id: request.headers.get("x-actor-id") ?? "unknown" },
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    now: () => new Date(),
  };
}

// --- usage_counters access (duplicated from packages/db — see header note) ---

const USAGE_SELECT_SQL =
  "select value from usage_counters where workspace_id = $1 and period = $2 and metric = $3 limit 1";
const USAGE_INCREMENT_SQL = `insert into usage_counters (workspace_id, period, metric, value)
values ($1, $2, $3, 1)
on conflict (workspace_id, period, metric)
do update set value = usage_counters.value + 1
returning value`;

class StopgapPgUsageRepo implements AiUsageRepo {
  constructor(private readonly pool: Pool) {}

  async currentCount(input: {
    workspaceId: string;
    metric: string;
    period: string;
  }): Promise<number> {
    const result = await this.pool.query(USAGE_SELECT_SQL, [
      input.workspaceId,
      input.period,
      input.metric,
    ]);
    const row = result.rows[0];
    return row ? Number(row.value ?? 0) : 0;
  }

  async increment(input: {
    workspaceId: string;
    metric: string;
    period: string;
  }): Promise<number> {
    const result = await this.pool.query(USAGE_INCREMENT_SQL, [
      input.workspaceId,
      input.period,
      input.metric,
    ]);
    const row = result.rows[0];
    if (!row) throw new Error("usage_counters increment returned no row");
    return Number(row.value);
  }
}

let poolSingleton: Pool | null = null;

function getPool(): Pool {
  if (!poolSingleton) {
    poolSingleton = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }
  return poolSingleton;
}

async function getPlan(workspaceId: string): Promise<Plan> {
  // INTEGRATION-DEBT (T23): entitlements lookup; direct table read until then.
  const result = await getPool().query<{ plan: string }>(
    "select plan from workspaces where id = $1 limit 1",
    [workspaceId],
  );
  const plan = result.rows[0]?.plan;
  if (plan === "pro" || plan === "business" || plan === "free") return plan;
  return "free";
}

/**
 * Builds the AI module deps. Returns a 503-shaped error when the deployment
 * lacks ANTHROPIC_API_KEY or DATABASE_URL — tests never hit this path
 * because they inject a FakeProvider at the core level.
 */
export async function createAiDeps(): Promise<Wired<AiModuleDeps>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!apiKey || !databaseUrl) {
    return {
      ok: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message: "AI features require ANTHROPIC_API_KEY and DATABASE_URL",
        status: 503,
      },
    };
  }

  // INTEGRATION-DEBT (T23): replace with billing.can(workspaceId, capability).
  // AI drafting is quota-limited per plan rather than plan-locked, so the
  // entitlement check passes until billing publishes the real capability.
  const can: CanFn = async () => true;

  return {
    ok: true,
    value: {
      provider: new AnthropicMessagesProvider({ apiKey }),
      can,
      getPlan,
      usage: new StopgapPgUsageRepo(getPool()),
    },
  };
}

// --- request payload validation ---------------------------------------------

const DOCUMENT_TYPES = ["form", "page", "portfolio"] as const;
const MAX_PROMPT_LENGTH = 2000;
const MAX_INSTRUCTION_LENGTH = 1000;

export type DraftPayload = {
  prompt: string;
  documentType: (typeof DOCUMENT_TYPES)[number];
};

export function parseDraftPayload(payload: unknown): Wired<DraftPayload> {
  if (typeof payload !== "object" || payload === null) {
    return validationError("Body must be a JSON object");
  }
  const { prompt, documentType } = payload as Record<string, unknown>;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return validationError("prompt is required and must be a non-empty string");
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return validationError(`prompt must be at most ${MAX_PROMPT_LENGTH} characters`);
  }
  const type = documentType === undefined ? "form" : documentType;
  if (typeof type !== "string" || !DOCUMENT_TYPES.includes(type as (typeof DOCUMENT_TYPES)[number])) {
    return validationError("documentType must be one of form, page, portfolio");
  }
  return {
    ok: true,
    value: {
      prompt: prompt.trim(),
      documentType: type as DraftPayload["documentType"],
    },
  };
}

export type EditPayload = {
  instruction: string;
  document: unknown; // validated against DocumentBody zod in the route
};

export function parseEditPayload(payload: unknown): Wired<EditPayload> {
  if (typeof payload !== "object" || payload === null) {
    return validationError("Body must be a JSON object");
  }
  const { instruction, document } = payload as Record<string, unknown>;
  if (typeof instruction !== "string" || instruction.trim().length === 0) {
    return validationError("instruction is required and must be a non-empty string");
  }
  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    return validationError(`instruction must be at most ${MAX_INSTRUCTION_LENGTH} characters`);
  }
  if (typeof document !== "object" || document === null) {
    return validationError("document is required (current DocumentBody JSON)");
  }
  return { ok: true, value: { instruction: instruction.trim(), document } };
}

function validationError(message: string): { ok: false; error: HttpError } {
  return {
    ok: false,
    error: { code: "VALIDATION", message, status: 422 },
  };
}
