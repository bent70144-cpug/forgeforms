// Tests for the Zod→OpenAPI pipeline and the API schemas (issue #25).

import { describe, expect, it } from 'vitest';
import { API_SCOPES as CORE_API_SCOPES } from '@formforge/core/api';
import {
  API_SCOPES,
  buildFormForgeOpenApi,
  buildOpenApiDocument,
  collectRefs,
  CreateDocumentRequestSchema,
  CreateTokenRequestSchema,
  CreateTokenResponseSchema,
  ErrorBodySchema,
  HTTP_STATUS_BY_CODE,
  ListDocumentsQuerySchema,
  serializeOpenApi,
  zodToSingleJsonSchema,
  type OpenApiDocument,
} from './index';

describe('error envelope (spec §4)', () => {
  it('accepts the exact §4 example shape', () => {
    const body = {
      error: {
        code: 'VALIDATION',
        message: 'Invalid input',
        details: [{ path: 'blocks[2].props.title', message: 'Required' }],
      },
    };
    expect(ErrorBodySchema.parse(body)).toEqual(body);
  });

  it('maps every code to its §4 HTTP status', () => {
    expect(HTTP_STATUS_BY_CODE).toEqual({
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      VALIDATION: 422,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      PLAN_LIMIT: 402,
      INTERNAL: 500,
    });
  });

  it('rejects unknown error codes', () => {
    expect(ErrorBodySchema.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(false);
  });
});

describe('request schemas', () => {
  it('CreateTokenRequest accepts valid scopes and rejects unknown ones', () => {
    expect(CreateTokenRequestSchema.parse({ name: ' CI ', scopes: ['docs:read', 'docs:write'] })).toEqual({
      name: 'CI',
      scopes: ['docs:read', 'docs:write'],
    });
    expect(CreateTokenRequestSchema.safeParse({ name: 'x', scopes: ['admin:all'] }).success).toBe(false);
    expect(CreateTokenRequestSchema.safeParse({ name: 'x', scopes: [] }).success).toBe(false);
  });

  it('CreateDocumentRequest validates type and title', () => {
    expect(CreateDocumentRequestSchema.parse({ type: 'form', title: 'Contact' }).type).toBe('form');
    expect(CreateDocumentRequestSchema.safeParse({ type: 'deck', title: 'x' }).success).toBe(false);
  });

  it('ListDocumentsQuery coerces limit from query strings', () => {
    expect(ListDocumentsQuerySchema.parse({ limit: '5' })).toMatchObject({ limit: 5 });
    expect(ListDocumentsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(ListDocumentsQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });

  it('reveal-once: only CreateTokenResponse carries the plaintext field', () => {
    const created = {
      id: '018f1c2e-7c1a-7cc2-9d3b-2f8a4d5e6f70',
      name: 'CI',
      scopes: ['docs:read'],
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      token: `ff_${'ab'.repeat(32)}`,
    };
    expect(CreateTokenResponseSchema.parse(created).token).toMatch(/^ff_[0-9a-f]{64}$/);
    // the listing DTO has no token field at all
    expect(Object.keys(CreateTokenResponseSchema.omit({ token: true }).shape).sort()).toEqual(
      ['createdAt', 'id', 'lastUsedAt', 'name', 'scopes'].sort(),
    );
  });
});

describe('scope contract with @formforge/core', () => {
  it('schema scopes are identical to core API_SCOPES (same strings, same order)', () => {
    expect([...API_SCOPES]).toEqual([...CORE_API_SCOPES]);
  });
});

describe('zodToSingleJsonSchema', () => {
  it('produces draft-2020-12 JSON Schema without the $schema key', () => {
    const json = zodToSingleJsonSchema(CreateTokenRequestSchema);
    expect(json).not.toHaveProperty('$schema');
    expect(json).toMatchObject({ type: 'object', required: ['name', 'scopes'] });
  });
});

describe('buildOpenApiDocument', () => {
  const doc = buildFormForgeOpenApi({ serverUrl: 'https://forgeforms.test' });

  it('is a structurally valid OpenAPI 3.1 document (parses as JSON, has required parts)', () => {
    const parsed = JSON.parse(serializeOpenApi(doc)) as OpenApiDocument;
    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.info.title).toBe('FormForge API');
    expect(parsed.info.version).toBe('1.0.0');
    expect(Object.keys(parsed.paths).length).toBeGreaterThan(0);
    expect(Object.keys(parsed.components.schemas).length).toBeGreaterThan(0);
    expect(parsed.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(parsed.components.securitySchemes.sessionCookie).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
    });
  });

  it('every $ref resolves to a registered component schema', () => {
    const refs = collectRefs(doc.paths);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('#/components/schemas/')).toBe(true);
      const name = ref.slice('#/components/schemas/'.length);
      expect(name in doc.components.schemas, `missing schema: ${name}`).toBe(true);
    }
  });

  it('matches the live /api/v1 routes on a sample', () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/documents',
        '/api/v1/documents/{id}',
        '/api/v1/documents/{id}/publish',
        '/api/v1/documents/{id}/unpublish',
        '/api/v1/tokens',
      ]),
    );
    const list = doc.paths['/api/v1/documents']!.get!;
    expect(list.responses['200']!.description).toBeTruthy();
    expect(list.responses['200']!.content?.['application/json']).toBeTruthy();
    expect(doc.paths['/api/v1/documents']!.post!.requestBody).toBeTruthy();
  });

  it('documents the §11 scopes per operation (x-required-scope)', () => {
    expect(doc.paths['/api/v1/documents']!.get!['x-required-scope']).toBe('docs:read');
    expect(doc.paths['/api/v1/documents']!.post!['x-required-scope']).toBe('docs:write');
    expect(doc.paths['/api/v1/documents/{id}']!.patch!['x-required-scope']).toBe('docs:write');
    expect(doc.paths['/api/v1/documents/{id}']!.delete!['x-required-scope']).toBe('docs:write');
    expect(doc.paths['/api/v1/documents/{id}/publish']!.post!['x-required-scope']).toBe('docs:publish');
    expect(doc.paths['/api/v1/documents/{id}/unpublish']!.post!['x-required-scope']).toBe('docs:publish');
  });

  it('documents endpoints accept bearer OR session; token routes are session-only', () => {
    const bearer = (doc.paths['/api/v1/documents']!.get!.security ?? []).some((s) => 'bearerAuth' in s);
    expect(bearer).toBe(true);

    for (const method of ['get', 'post', 'delete'] as const) {
      const op = doc.paths['/api/v1/tokens']![method]!;
      const securities = op.security ?? [];
      expect(securities.some((s) => 'bearerAuth' in s), `${method} /tokens must not allow bearer`).toBe(false);
      expect(securities.some((s) => 'sessionCookie' in s)).toBe(true);
    }
  });

  it('component schemas are real JSON Schemas for their Zod sources', () => {
    const token = doc.components.schemas['Token']!;
    expect(token).toMatchObject({ type: 'object' });
    const props = token['properties'] as Record<string, { type?: unknown; anyOf?: unknown }>;
    expect(props['scopes']).toBeTruthy();
    expect(props['lastUsedAt']).toBeTruthy(); // nullable → anyOf string/null
    expect(JSON.stringify(props['lastUsedAt'])).toContain('null');
  });
});

describe('buildOpenApiDocument validation', () => {
  const schema = CreateTokenRequestSchema;

  it('throws on unregistered $refs', () => {
    expect(() =>
      buildOpenApiDocument({
        title: 't',
        version: '0',
        schemas: { Known: schema },
        securitySchemes: {},
        paths: {
          '/x': {
            get: {
              operationId: 'op',
              responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } },
            },
          },
        },
      }),
    ).toThrow(/unregistered schema references/);
  });

  it('throws on paths without operations and operations without responses', () => {
    expect(() =>
      buildOpenApiDocument({
        title: 't',
        version: '0',
        schemas: {},
        securitySchemes: {},
        paths: { '/empty': { parameters: [] } },
      }),
    ).toThrow(/has no operations/);

    expect(() =>
      buildOpenApiDocument({
        title: 't',
        version: '0',
        schemas: {},
        securitySchemes: {},
        paths: { '/no-responses': { get: { operationId: 'op', responses: {} } } },
      }),
    ).toThrow(/has no responses/);
  });
});
