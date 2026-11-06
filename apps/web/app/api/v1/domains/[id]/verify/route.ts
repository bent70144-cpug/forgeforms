// POST /api/v1/domains/[id]/verify — re-check DNS ownership (issue #24).
// Success flips pending → verified and registers the Host → documentId routing
// entry (spec §10.1). A failed check returns 200 with verified:false — the
// domain stays pending and NEVER routes; the settings UI shows the state.
import { AppError, requireScope } from '@formforge/core/api';
import { authenticate } from '../../../../_lib/auth';
import { handleApiError, ok } from '../../../../_lib/respond';
import { getDomainsService, routingTarget } from '../../../../../../lib/domains/server';
import { domainToDto } from '../../../../../../lib/domains/dto';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: true });
    if (ctx.actor.kind === 'token') {
      requireScope(ctx.scopes, 'docs:write');
    }
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      throw AppError.validation('Invalid domain id', [{ path: 'id', message: 'Must be a uuid' }]);
    }
    const service = getDomainsService();
    const result = await service.verifyDomain(ctx, id);
    if (!result.ok) throw result.error;
    return ok({
      domain: domainToDto(result.value.domain, routingTarget()),
      verified: result.value.verified,
      method: result.value.method,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
