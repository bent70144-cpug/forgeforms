// T18 (issue #18) — object storage seam for finished CSV files (spec §12: "stream
// rows by cursor to S3"). The service depends on this narrow interface only;
// production wires S3, tests/dev use the in-memory implementation.

export type ObjectPutInput = {
  /** Object key, e.g. `exports/<workspaceId>/<documentId>/<exportId>.csv`. */
  key: string;
  /** CSV body; async iterables are consumed chunk-by-chunk (bounded memory). */
  body: string | AsyncIterable<string> | Iterable<string>;
  contentType?: string;
};

export type ObjectGetResult = {
  key: string;
  body: string;
  sizeBytes: number;
  contentType?: string;
};

export interface ObjectStore {
  put(input: ObjectPutInput): Promise<{ key: string; sizeBytes: number }>;
  get(key: string): Promise<ObjectGetResult | null>;
}

/**
 * In-memory ObjectStore — used by unit tests and local dev. Sizes are measured
 * in UTF-8 bytes (TextEncoder), matching what S3 would report via Content-Length.
 */
export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, { chunks: string[]; sizeBytes: number; contentType?: string }>();
  readonly #encoder = new TextEncoder();

  async put(input: ObjectPutInput): Promise<{ key: string; sizeBytes: number }> {
    const chunks: string[] = [];
    let sizeBytes = 0;
    if (typeof input.body === "string") {
      chunks.push(input.body);
    } else {
      for await (const chunk of input.body) chunks.push(chunk);
    }
    for (const chunk of chunks) sizeBytes += this.#encoder.encode(chunk).length;
    this.#objects.set(input.key, { chunks, sizeBytes, contentType: input.contentType });
    return { key: input.key, sizeBytes };
  }

  async get(key: string): Promise<ObjectGetResult | null> {
    const object = this.#objects.get(key);
    if (!object) return null;
    return { key, body: object.chunks.join(""), sizeBytes: object.sizeBytes, contentType: object.contentType };
  }

  /** Test helper: raw stored text ("" for absent keys is ambiguous — use has()). */
  text(key: string): string | undefined {
    return this.#objects.get(key)?.chunks.join("");
  }

  has(key: string): boolean {
    return this.#objects.has(key);
  }
}

/**
 * S3-backed ObjectStore (production target: Cloudflare R2, spec §1).
 * INTEGRATION-DEBT: implement with `@aws-sdk/client-s3` (PutObject with a
 * body stream / GetObject) once the assets ticket lands the SDK dependency —
 * intentionally left unwired so T18 adds zero new deps.
 */
export function createS3ObjectStore(): ObjectStore {
  const notImplemented = (): never => {
    throw new Error(
      "INTEGRATION-DEBT: S3 ObjectStore is not implemented yet — wire @aws-sdk/client-s3 " +
        "(S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY env, spec §5). " +
        "Use InMemoryObjectStore for tests/dev.",
    );
  };
  return {
    put: async () => notImplemented(),
    get: async () => notImplemented(),
  };
}
