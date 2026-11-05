// GET /api/openapi.json — the OpenAPI 3.1 document, generated from the Zod
// schemas in @formforge/schema/api (single source, issue #25). Zero runtime
// dependencies: the converter is pure.
import { buildFormForgeOpenApi, serializeOpenApi } from '@formforge/schema/api';

export const dynamic = 'force-static';

export function GET(): Response {
  const body = serializeOpenApi(buildFormForgeOpenApi());
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
}
