// GET /api/v1/domains — list custom domains with verification state (issue #24).
// POST /api/v1/domains — attach a hostname (pending) + DNS instructions.
//                        PLAN_LIMIT → HTTP 402 (spec §13 quota: no | 1 | 5).
// DELETE /api/v1/domains?id=… — remove + unroute + purge cache.
//
// Auth: session OR bearer (spec §11 default). Bearer tokens need docs:write;
// sessions are authorized by role once T04 lands (same posture as documents).
import { AppError, requireScope } from '@formforge/core/api';
import { CreateDomainRequestSchema } from '@formforge/schema/api';
import { authenticate } from '../_lib/auth';
import { created, handleApiError, listResponse, noContent } from '../_lib/respond';
import { toServiceCtx } from '../../../../lib/domains/api-ctx';
import { getDomainsService, routingTarget } from '../../../../lib/domains/server';
import { domainToDto } from '../../../../lib/domains/dto';

export const dynamic = 'force-dynamic';

/** Bearer actors must carry docs:write; sessions pass (role checks = T04). */
function requireWriteScope(ctx: Awaited<ReturnType<typeof authenticate>>): void {
  if (ctx.actor.kind === 'token') {
    requireScope(ctx.scopes, 'docs:write');
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: true });
    requireWriteScope(ctx);
    const service = getDomainsService();
    const domains = await service.listDomains(toServiceCtx(ctx));
    return listResponse(domains.map((d) => domainToDto(d, routingTarget())), null);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: true });
    requireWriteScope(ctx);
    const json: unknown = await req.json().catch(() => null);
    const parsed = CreateDomainRequestSchema.safeParse(json);
    if (!parsed.success) throw parsed.error;
    const service = getDomainsService();
    const result = await service.addDomain(toServiceCtx(ctx), parsed.data);
    if (!result.ok) throw result.error;
    return created({
      domain: domainToDto(result.value.domain, routingTarget()),
      instructions: result.value.instructions,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: true });
    requireWriteScope(ctx);
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      throw AppError.validation('Missing domain id', [{ path: 'id', message: 'Required query parameter' }]);
    }
    const service = getDomainsService();
    const result = await service.removeDomain(toServiceCtx(ctx), id);
    if (!result.ok) throw result.error;
    return noContent();
  } catch (error) {
    return handleApiError(error);
  }
}
