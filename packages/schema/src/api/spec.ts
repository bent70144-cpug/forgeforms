// The FormForge v1 OpenAPI document, generated from the Zod schemas above
// (issue #25: "OpenAPI document generated from the Zod schemas (single source)").
//
// Coverage: the /api/v1 surface that exists today (documents demo routes +
// token management) plus the spec §11 documents endpoints T07 finalizes.
// Session-only management routes (workspace, members, billing) are not part of
// the public API contract and are intentionally omitted.
import {
  buildOpenApiDocument,
  schemaRef,
  type OpenApiDocument,
  type OpenApiPathItem,
  type OpenApiSecurityScheme,
  type OpenApiParameter,
  type SecurityRequirement,
} from './openapi';
import {
  CreateDocumentRequestSchema,
  DocumentDetailSchema,
  DocumentSummarySchema,
  ListDocumentsResponseSchema,
  PatchDocumentRequestSchema,
  PublishDocumentResponseSchema,
} from './documents';
import {
  CreateTokenRequestSchema,
  CreateTokenResponseSchema,
  ListTokensResponseSchema,
  TokenSchema,
} from './tokens';
import { ErrorBodySchema } from './errors';

/** All named component schemas — the single source registry. */
export const FORMFORGE_API_SCHEMAS = {
  ErrorBody: ErrorBodySchema,
  DocumentSummary: DocumentSummarySchema,
  DocumentDetail: DocumentDetailSchema,
  CreateDocumentRequest: CreateDocumentRequestSchema,
  ListDocumentsResponse: ListDocumentsResponseSchema,
  PatchDocumentRequest: PatchDocumentRequestSchema,
  PublishDocumentResponse: PublishDocumentResponseSchema,
  Token: TokenSchema,
  CreateTokenRequest: CreateTokenRequestSchema,
  CreateTokenResponse: CreateTokenResponseSchema,
  ListTokensResponse: ListTokensResponseSchema,
} as const;

const BEARER: OpenApiSecurityScheme = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'opaque-token',
  description:
    'API token created in Settings → API tokens. Format `ff_<32 hex>`. Scopes: docs:read, docs:write, docs:publish, submissions:read.',
};

const SESSION: OpenApiSecurityScheme = {
  type: 'apiKey',
  in: 'cookie',
  name: 'authjs.session-token',
  description: 'Browser session (Auth.js v5). Used by the dashboard UI; cannot be granted scopes.',
};

/** bearer OR session — the spec §11 default for /api/v1. */
const BEARER_OR_SESSION: readonly SecurityRequirement[] = [{ bearerAuth: [] }, { sessionCookie: [] }];
/** Token management is session-only (spec §11). */
const SESSION_ONLY: readonly SecurityRequirement[] = [{ sessionCookie: [] }];

const ID_PARAM: OpenApiParameter = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Document id (uuid)',
  schema: { type: 'string', format: 'uuid' },
};

const JSON_MEDIA = 'application/json';

const RATE_LIMIT_NOTE =
  'Rate limit: 600 req/min per API token, 300 req/min per session (spec §11). Exceeding it returns 429 RATE_LIMITED.';

const err = (description: string) => ({
  description,
  content: { [JSON_MEDIA]: { schema: schemaRef('ErrorBody') } },
});

const jsonBody = (ref: string, example?: unknown) => ({
  required: true as const,
  content: { [JSON_MEDIA]: { schema: schemaRef(ref), ...(example !== undefined ? { example } : {}) } },
});

const jsonResponse = (description: string, ref: string) => ({
  description,
  content: { [JSON_MEDIA]: { schema: schemaRef(ref) } },
});

export function buildFormForgeOpenApi(options?: { serverUrl?: string }): OpenApiDocument {
  const documentsItem: OpenApiPathItem = {
    get: {
      operationId: 'listDocuments',
      summary: 'List documents',
      description: `List documents in the token's workspace. Filters: type, status, q (title search). ${RATE_LIMIT_NOTE}`,
      tags: ['documents'],
      'x-required-scope': 'docs:read',
      security: BEARER_OR_SESSION,
      parameters: [
        { name: 'type', in: 'query', schema: { type: 'string', enum: ['form', 'page', 'portfolio'] } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'published', 'archived'] } },
        { name: 'q', in: 'query', description: 'Title search', schema: { type: 'string', maxLength: 200 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        { name: 'cursor', in: 'query', description: 'Opaque cursor from a previous page', schema: { type: 'string' } },
      ],
      responses: {
        '200': jsonResponse('Paginated document list', 'ListDocumentsResponse'),
        '403': err('Credential missing the docs:read scope'),
        '429': err('Rate limited'),
      },
    },
    post: {
      operationId: 'createDocument',
      summary: 'Create a document',
      description: `Create a form, page or portfolio (optionally from a template). ${RATE_LIMIT_NOTE}`,
      tags: ['documents'],
      'x-required-scope': 'docs:write',
      security: BEARER_OR_SESSION,
      requestBody: jsonBody('CreateDocumentRequest', { type: 'form', title: 'Contact form' }),
      responses: {
        '201': jsonResponse('Created document (draft)', 'DocumentDetail'),
        '403': err('Credential missing the docs:write scope'),
        '422': err('Validation failed'),
        '429': err('Rate limited'),
      },
    },
  };

  const documentIdItem: OpenApiPathItem = {
    parameters: [ID_PARAM],
    get: {
      operationId: 'getDocument',
      summary: 'Get a document',
      description: `Draft body + metadata. ${RATE_LIMIT_NOTE}`,
      tags: ['documents'],
      'x-required-scope': 'docs:read',
      security: BEARER_OR_SESSION,
      responses: {
        '200': jsonResponse('The document', 'DocumentDetail'),
        '403': err('Credential missing the docs:read scope'),
        '404': err('Document not found in this workspace'),
      },
    },
    patch: {
      operationId: 'patchDocument',
      summary: 'Apply ops to a document',
      description: `Apply ops with optimistic concurrency (baseRev). Conflicting edits return 409. ${RATE_LIMIT_NOTE}`,
      tags: ['documents'],
      'x-required-scope': 'docs:write',
      security: BEARER_OR_SESSION,
      requestBody: jsonBody('PatchDocumentRequest'),
      responses: {
        '200': jsonResponse('Updated document', 'DocumentDetail'),
        '403': err('Credential missing the docs:write scope'),
        '404': err('Document not found in this workspace'),
        '409': err('Revision conflict — refetch and retry'),
        '422': err('Validation failed'),
      },
    },
    delete: {
      operationId: 'deleteDocument',
      summary: 'Archive a document',
      description: `Soft-delete (status → archived). ${RATE_LIMIT_NOTE}`,
      tags: ['documents'],
      'x-required-scope': 'docs:write',
      security: BEARER_OR_SESSION,
      responses: {
        '204': { description: 'Archived' },
        '403': err('Credential missing the docs:write scope'),
        '404': err('Document not found in this workspace'),
      },
    },
  };

  const publishItem: OpenApiPathItem = {
    parameters: [ID_PARAM],
    post: {
      operationId: 'publishDocument',
      summary: 'Publish a document',
      description: `Snapshot the draft and flip status to published (live public URL). ${RATE_LIMIT_NOTE}`,
      tags: ['documents'],
      'x-required-scope': 'docs:publish',
      security: BEARER_OR_SESSION,
      responses: {
        '200': jsonResponse('Published version info', 'PublishDocumentResponse'),
        '403': err('Credential missing the docs:publish scope'),
        '404': err('Document not found in this workspace'),
        '422': err('Draft fails validation'),
      },
    },
  };

  const unpublishItem: OpenApiPathItem = {
    parameters: [ID_PARAM],
    post: {
      operationId: 'unpublishDocument',
      summary: 'Unpublish a document',
      description: `Take the published version offline (subsequent public requests return 410). ${RATE_LIMIT_NOTE}`,
      tags: ['documents'],
      'x-required-scope': 'docs:publish',
      security: BEARER_OR_SESSION,
      responses: {
        '200': jsonResponse('Document back in draft', 'DocumentDetail'),
        '403': err('Credential missing the docs:publish scope'),
        '404': err('Document not found in this workspace'),
      },
    },
  };

  const tokensItem: OpenApiPathItem = {
    get: {
      operationId: 'listTokens',
      summary: 'List API tokens',
      description: 'Session-only. Returns token metadata — never hashes, never plaintexts.',
      tags: ['tokens'],
      security: SESSION_ONLY,
      responses: {
        '200': jsonResponse('Token list', 'ListTokensResponse'),
        '403': err('No session'),
      },
    },
    post: {
      operationId: 'createToken',
      summary: 'Create an API token',
      description:
        'Session-only. The response contains the plaintext token EXACTLY ONCE — only its SHA-256 hash is stored. This is the only time it can be copied.',
      tags: ['tokens'],
      security: SESSION_ONLY,
      requestBody: jsonBody('CreateTokenRequest', { name: 'CI', scopes: ['docs:read', 'docs:write'] }),
      responses: {
        '201': jsonResponse('Created token (plaintext revealed once)', 'CreateTokenResponse'),
        '403': err('No session'),
        '422': err('Validation failed'),
      },
    },
    delete: {
      operationId: 'revokeToken',
      summary: 'Revoke an API token',
      description: 'Session-only. Deletes the token row; the plaintext stops working immediately.',
      tags: ['tokens'],
      security: SESSION_ONLY,
      parameters: [
        { name: 'id', in: 'query', required: true, description: 'Token id to revoke', schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '204': { description: 'Revoked' },
        '403': err('No session'),
        '404': err('Token not found in this workspace'),
      },
    },
  };

  return buildOpenApiDocument({
    title: 'FormForge API',
    version: '1.0.0',
    description:
      'Authenticated /api/v1 for FormForge — forms, landing pages and portfolios on one block-document model. ' +
      'Authenticate with `Authorization: Bearer ff_…` (scoped API token) or a browser session cookie. ' +
      'All errors use the spec §4 envelope: { "error": { "code", "message", "details?" } }.',
    servers: [{ url: options?.serverUrl ?? '/', description: 'This deployment' }],
    tags: [
      { name: 'documents', description: 'Forms, pages and portfolios (docs:read / docs:write / docs:publish)' },
      { name: 'tokens', description: 'API token management (session only)' },
    ],
    schemas: FORMFORGE_API_SCHEMAS,
    paths: {
      '/api/v1/documents': documentsItem,
      '/api/v1/documents/{id}': documentIdItem,
      '/api/v1/documents/{id}/publish': publishItem,
      '/api/v1/documents/{id}/unpublish': unpublishItem,
      '/api/v1/tokens': tokensItem,
    },
    securitySchemes: {
      bearerAuth: BEARER,
      sessionCookie: SESSION,
    },
  });
}
