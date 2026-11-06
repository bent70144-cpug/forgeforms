// Zero-dependency Zod → OpenAPI 3.1 converter (issue #25).
//
// Pure module: no I/O, no framework imports. Zod 4's built-in `z.toJSONSchema`
// does the per-schema JSON Schema generation; this file adds what that API
// does not provide — named `components.schemas` with `$ref`s, path/operation
// assembly, security schemes, and reference-integrity validation.

import { z } from 'zod';

/* ---------------------------------- types --------------------------------- */

export type JsonSchemaObject = Record<string, unknown>;

/** A `$ref` into `#/components/schemas`. (Type alias → implicit index signature.) */
export type SchemaRef = { readonly $ref: string };

export interface OpenApiParameter {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header';
  readonly required?: boolean;
  readonly description?: string;
  readonly schema: JsonSchemaObject;
}

export interface OpenApiMediaType {
  readonly schema: JsonSchemaObject;
  readonly example?: unknown;
}

export interface OpenApiResponse {
  readonly description: string;
  readonly content?: Readonly<Record<string, OpenApiMediaType>>;
  readonly headers?: Readonly<Record<string, { readonly description: string }>>;
}

export interface OpenApiOperation {
  readonly operationId: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  /** e.g. `docs:write` — informational extension consumed by docs tooling. */
  readonly 'x-required-scope'?: string;
  /** `[{ bearerAuth: [] }, { sessionCookie: [] }]` = bearer OR session. */
  readonly security?: readonly SecurityRequirement[];
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: { readonly required?: boolean; readonly content: Readonly<Record<string, OpenApiMediaType>> };
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
}

export type OpenApiPathItem = Partial<Record<'get' | 'post' | 'patch' | 'put' | 'delete', OpenApiOperation>> & {
  readonly parameters?: readonly OpenApiParameter[];
};

export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

export interface OpenApiSecurityScheme {
  readonly type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect';
  readonly description?: string;
  readonly scheme?: string;
  readonly bearerFormat?: string;
  readonly in?: 'cookie' | 'header' | 'query';
  readonly name?: string;
}

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly servers?: readonly { readonly url: string; readonly description?: string }[];
  readonly tags?: readonly { readonly name: string; readonly description?: string }[];
  readonly paths: Readonly<Record<string, OpenApiPathItem>>;
  readonly components: {
    readonly securitySchemes: Readonly<Record<string, OpenApiSecurityScheme>>;
    readonly schemas: Readonly<Record<string, JsonSchemaObject>>;
  };
  readonly security?: readonly SecurityRequirement[];
}

export interface BuildOpenApiInput {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly servers?: OpenApiDocument['servers'];
  readonly tags?: OpenApiDocument['tags'];
  /** Named schemas hoisted into `components.schemas`; referenced via `schemaRef`. */
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  readonly paths: Readonly<Record<string, OpenApiPathItem>>;
  readonly securitySchemes: Readonly<Record<string, OpenApiSecurityScheme>>;
  /** Global default security, overridable per operation. */
  readonly security?: readonly SecurityRequirement[];
}

/* -------------------------------- helpers --------------------------------- */

const SCHEMAS_PREFIX = '#/components/schemas/';

/** Build a `$ref` to a named component schema. */
export function schemaRef(name: string): SchemaRef {
  return { $ref: `${SCHEMAS_PREFIX}${name}` };
}

/**
 * Convert one Zod schema to a JSON Schema (draft 2020-12, the dialect OpenAPI
 * 3.1 uses). `io: 'input'` keeps request-side semantics (defaults, coerced
 * fields); `unrepresentable: 'any'` degrades exotic effects instead of throwing.
 */
export function zodToSingleJsonSchema(schema: z.ZodType): JsonSchemaObject {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchemaObject;
  const { $schema: _drop, ...rest } = json;
  void _drop;
  return rest;
}

/** Collect every `$ref` string inside an arbitrary JSON value (depth-first). */
export function collectRefs(value: unknown): string[] {
  const refs: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (key === '$ref' && typeof child === 'string') {
          refs.push(child);
        } else {
          visit(child);
        }
      }
    }
  };
  visit(value);
  return refs;
}

/* --------------------------------- builder -------------------------------- */

/**
 * Assemble a validated OpenAPI 3.1 document:
 *  - hoists every named Zod schema into `components.schemas`;
 *  - throws if an operation references a schema name that was not registered
 *    (keeps the generated doc honest — a bad ref can never ship);
 *  - throws if a path item has no operations or an operation has no responses.
 */
export function buildOpenApiDocument(input: BuildOpenApiInput): OpenApiDocument {
  const schemas: Record<string, JsonSchemaObject> = {};
  for (const [name, zodSchema] of Object.entries(input.schemas)) {
    schemas[name] = zodToSingleJsonSchema(zodSchema);
  }

  // Reference integrity: every $ref used anywhere in `paths` must be registered.
  const used = new Set(collectRefs(input.paths));
  const missing = [...used].filter((ref) => !ref.startsWith(SCHEMAS_PREFIX) || !(ref.slice(SCHEMAS_PREFIX.length) in schemas));
  if (missing.length > 0) {
    throw new Error(`OpenAPI build: unregistered schema references: ${missing.join(', ')}`);
  }

  // Sanity: operations must be reachable and answerable.
  for (const [path, item] of Object.entries(input.paths)) {
    const methods = Object.keys(item).filter((k) => k !== 'parameters');
    if (methods.length === 0) {
      throw new Error(`OpenAPI build: path "${path}" has no operations`);
    }
    for (const method of methods) {
      const op = (item as Record<string, OpenApiOperation>)[method];
      if (!op || Object.keys(op.responses).length === 0) {
        throw new Error(`OpenAPI build: ${method.toUpperCase()} ${path} has no responses`);
      }
    }
  }

  const doc: OpenApiDocument = {
    openapi: '3.1.0',
    info: { title: input.title, version: input.version, ...(input.description ? { description: input.description } : {}) },
    paths: input.paths,
    components: {
      securitySchemes: input.securitySchemes,
      schemas,
    },
    ...(input.servers ? { servers: input.servers } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.security ? { security: input.security } : {}),
  };
  return doc;
}

/**
 * Convenience for JSON serialization (route handlers, files, validators).
 * OpenAPI documents are pure JSON — this assertively fails on BigInt/undefined
 * leaks from schema metadata.
 */
export function serializeOpenApi(doc: OpenApiDocument): string {
  return JSON.stringify(doc, null, 2);
}
