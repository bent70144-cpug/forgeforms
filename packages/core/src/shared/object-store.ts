// Shared kernel: ObjectStore port — S3-compatible object storage (spec §1/§5).
//
// Started as T18's narrow CSV seam (put/get); T16 (issue #16) extends the SAME
// port with the asset-plane operations the upload flow needs (spec §10.1
// presign, §17 "signed URLs only" + magic-byte sniffing):
//   head / readRange / remove / presignPut / presignGet.
//
// Production target: Cloudflare R2 (S3 API) via @aws-sdk/client-s3 +
// @aws-sdk/s3-request-presigner; tests/dev use the in-memory implementation.
// `export/object-store.ts` re-exports this module so T18's public surface and
// the "swap the fake for S3" integration-debt item are resolved in one place.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type ObjectPutInput = {
  /** Object key, e.g. `exports/<workspaceId>/<documentId>/<exportId>.csv`. */
  key: string;
  /** Object body; async iterables are consumed chunk-by-chunk (bounded memory). */
  body: string | Uint8Array | AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array>;
  contentType?: string;
};

export type ObjectGetResult = {
  key: string;
  body: string;
  sizeBytes: number;
  contentType?: string;
};

export type ObjectMeta = { key: string; sizeBytes: number; contentType?: string };

export type PresignPutInput = {
  contentType?: string;
  expiresInSeconds: number;
};

export type PresignResult = { url: string; key: string };

export interface ObjectStore {
  put(input: ObjectPutInput): Promise<{ key: string; sizeBytes: number }>;
  get(key: string): Promise<ObjectGetResult | null>;
  /** Existence + metadata without the body (upload confirm, spec §10.1). */
  head(key: string): Promise<ObjectMeta | null>;
  /** First `length` bytes — magic-byte sniffing (spec §17). */
  readRange(key: string, length: number): Promise<Uint8Array | null>;
  /** Delete the object (purge of rejected/infected uploads). */
  remove(key: string): Promise<void>;
  /** Presigned PUT for direct browser uploads (spec §10.1, no proxying). */
  presignPut(key: string, opts: PresignPutInput): Promise<PresignResult>;
  /** Presigned GET — signed downloads only; no public bucket (spec §17). */
  presignGet(key: string, opts: { expiresInSeconds: number }): Promise<PresignResult | null>;
}

/* ---------------------------------------------------------------------------
 * In-memory implementation — unit tests + local dev without MinIO.
 * Sizes are measured in bytes (TextEncoder), matching S3's Content-Length.
 * ------------------------------------------------------------------------- */

export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<
    string,
    { bytes: Uint8Array; sizeBytes: number; contentType?: string }
  >();
  readonly #encoder = new TextEncoder();
  // ignoreBOM:true keeps a leading U+FEFF (CSV_BOM) intact on decode — the
  // historical string-join behavior T18's tests pin.
  readonly #decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  readonly #now: () => Date;

  constructor(opts: { now?: () => Date } = {}) {
    this.#now = opts.now ?? (() => new Date());
  }

  async put(input: ObjectPutInput): Promise<{ key: string; sizeBytes: number }> {
    let bytes: Uint8Array;
    if (typeof input.body === "string") {
      bytes = this.#encoder.encode(input.body);
    } else if (input.body instanceof Uint8Array) {
      bytes = input.body;
    } else {
      const chunks: Uint8Array[] = [];
      let sizeBytes = 0;
      for await (const chunk of input.body) {
        const c = typeof chunk === "string" ? this.#encoder.encode(chunk) : chunk;
        chunks.push(c);
        sizeBytes += c.byteLength;
      }
      bytes = new Uint8Array(sizeBytes);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
    }
    this.#objects.set(input.key, { bytes, sizeBytes: bytes.byteLength, contentType: input.contentType });
    return { key: input.key, sizeBytes: bytes.byteLength };
  }

  async get(key: string): Promise<ObjectGetResult | null> {
    const object = this.#objects.get(key);
    if (!object) return null;
    // Text view of the object — T18 CSV consumers only; binary assets go
    // through readRange/presignGet instead.
    return {
      key,
      body: this.#decoder.decode(object.bytes),
      sizeBytes: object.sizeBytes,
      contentType: object.contentType,
    };
  }

  async head(key: string): Promise<ObjectMeta | null> {
    const object = this.#objects.get(key);
    if (!object) return null;
    return { key, sizeBytes: object.sizeBytes, contentType: object.contentType };
  }

  async readRange(key: string, length: number): Promise<Uint8Array | null> {
    const object = this.#objects.get(key);
    if (!object) return null;
    return object.bytes.slice(0, Math.max(0, length));
  }

  async remove(key: string): Promise<void> {
    this.#objects.delete(key);
  }

  /** Test helper: raw stored text (undefined for absent keys — use has()). */
  text(key: string): string | undefined {
    const object = this.#objects.get(key);
    return object ? this.#decoder.decode(object.bytes) : undefined;
  }

  has(key: string): boolean {
    return this.#objects.has(key);
  }

  /**
   * Presigned PUT: deterministic URL carrying the key + expiry. The sandbox
   * has no live S3, so tests confirm uploads by calling `put()` directly and
   * can simulate a browser by feeding this URL to `validatePresignedPut`.
   */
  async presignPut(key: string, opts: PresignPutInput): Promise<PresignResult> {
    const expires = Math.floor(this.#now().getTime() / 1000) + opts.expiresInSeconds;
    const url =
      `mem://formforge/${key}` +
      `?X-FormForge-ObjectStore=put&X-Amz-Expires=${opts.expiresInSeconds}&X-Amz-Date=${expires}`;
    return { url, key };
  }

  /** Presigned GET is only issued for objects that exist (signed downloads). */
  async presignGet(key: string, opts: { expiresInSeconds: number }): Promise<PresignResult | null> {
    if (!this.#objects.has(key)) return null;
    const expires = Math.floor(this.#now().getTime() / 1000) + opts.expiresInSeconds;
    const url =
      `mem://formforge/${key}` +
      `?X-FormForge-ObjectStore=get&X-Amz-Expires=${opts.expiresInSeconds}&X-Amz-Date=${expires}`;
    return { url, key };
  }

  /**
   * Test/dev helper: validate an in-memory presigned PUT URL ("the browser
   * used it"). Real S3 enforces the signature server-side; here the expiry
   * check stands in for it.
   */
  validatePresignedPut(
    url: string,
    now: Date = this.#now(),
  ): { ok: true; key: string } | { ok: false; reason: "malformed" | "expired" } {
    const match = /^mem:\/\/formforge\/(.+)\?X-FormForge-ObjectStore=put&(?:X-Amz-Expires=(\d+)&)?X-Amz-Date=(\d+)$/.exec(
      url,
    );
    if (!match) return { ok: false, reason: "malformed" };
    const key = match[1]!;
    const expiresAtSeconds = Number(match[3]);
    if (!Number.isSafeInteger(expiresAtSeconds)) return { ok: false, reason: "malformed" };
    if (Math.floor(now.getTime() / 1000) > expiresAtSeconds) return { ok: false, reason: "expired" };
    return { ok: true, key };
  }
}

/* ---------------------------------------------------------------------------
 * S3-backed implementation (production: Cloudflare R2, dev: MinIO, spec §5).
 * ------------------------------------------------------------------------- */

export type S3ObjectStoreConfig = {
  /** e.g. MinIO http://localhost:9000 or omit for real AWS. */
  endpoint?: string;
  /** "auto" for R2, any region for MinIO. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO/R2 need path-style addressing. */
  forcePathStyle?: boolean;
};

export function createS3ObjectStore(config: S3ObjectStoreConfig): ObjectStore {
  const client = new S3Client({
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? true,
  });

  async function bodyToBytes(body: ObjectPutInput["body"]): Promise<Uint8Array> {
    if (typeof body === "string") return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return body;
    const chunks: Uint8Array[] = [];
    let sizeBytes = 0;
    for await (const chunk of body) {
      const c = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      chunks.push(c);
      sizeBytes += c.byteLength;
    }
    const bytes = new Uint8Array(sizeBytes);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    return bytes;
  }

  return {
    async put(input) {
      // Streams are buffered to bytes to keep Content-Length exact (S3
      // requires a known length unless using multipart); CSV exports are
      // capped by the job contract, uploads by the 50 MB hard cap.
      const bytes = await bodyToBytes(input.body);
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: bytes,
          ...(input.contentType ? { ContentType: input.contentType } : {}),
        }),
      );
      return { key: input.key, sizeBytes: bytes.byteLength };
    },

    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      if (!res.Body) return null;
      const body = await res.Body.transformToString("utf8");
      return {
        key,
        body,
        sizeBytes: res.ContentLength ?? Buffer.byteLength(body, "utf8"),
        ...(res.ContentType ? { contentType: res.ContentType } : {}),
      };
    },

    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return {
          key,
          sizeBytes: res.ContentLength ?? 0,
          ...(res.ContentType ? { contentType: res.ContentType } : {}),
        };
      } catch (error) {
        const name = (error as { name?: string }).name ?? "";
        if (name === "NotFound" || name === "NoSuchKey" || name === "404") return null;
        throw error;
      }
    },

    async readRange(key, length) {
      if (length <= 0) return new Uint8Array(0);
      const res = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Range: `bytes=0-${length - 1}`,
        }),
      );
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return bytes.slice(0, length);
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },

    async presignPut(key, opts) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ...(opts.contentType ? { ContentType: opts.contentType } : {}),
        }),
        { expiresIn: opts.expiresInSeconds },
      );
      return { url, key };
    },

    async presignGet(key, opts) {
      // Existence check keeps "signed downloads only" honest for absent keys.
      const meta = await (async () => {
        try {
          return await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        } catch {
          return null;
        }
      })();
      if (!meta) return null;
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { expiresIn: opts.expiresInSeconds },
      );
      return { url, key };
    },
  };
}

/** Build the S3 config from env (spec §5) — null when storage is not configured. */
export function s3ObjectStoreConfigFromEnv(
  env: Record<string, string | undefined>,
): S3ObjectStoreConfig | null {
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    region: env.S3_REGION ?? "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true, // MinIO + R2 both want path-style
  };
}

/**
 * Storage factory used by apps/web + apps/worker wiring: S3/MinIO when env is
 * configured, in-memory otherwise (dev/tests without docker, spec §5 defaults).
 */
export function objectStoreFromEnv(env: Record<string, string | undefined>): ObjectStore {
  const config = s3ObjectStoreConfigFromEnv(env);
  return config ? createS3ObjectStore(config) : new InMemoryObjectStore();
}
