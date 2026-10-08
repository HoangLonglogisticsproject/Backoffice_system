import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { AwsClient } from 'aws4fetch';
import type { ObjectStorage } from '../../common/types/object-storage.port';
import { assertStorageKey } from './storage-key';

export interface R2Settings {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** A slow bucket must not hold a request open until the proxy gives up. */
const TIMEOUT_MS = 15_000;

/**
 * A PRIVATE Cloudflare R2 bucket, over its S3 API — the production store.
 *
 * ★ SIGNED BY `aws4fetch`, NOT BY HAND. SigV4 is a canonicalisation scheme
 * where a one-byte mistake is a silent 403 or, worse, a signature over the
 * wrong thing; a maintained implementation (pinned, audited, zero
 * dependencies) beats a homemade one. Its default of ten retries is cut to
 * two, so a failing bucket answers in seconds.
 *
 * ★ THE BODY IS SIGNED TOO. For S3, aws4fetch signs `UNSIGNED-PAYLOAD` unless
 * told the body's hash; a write here sends it, so the bucket refuses any byte
 * that is not the one signed.
 *
 * Nothing here produces a URL for a browser: the backend reads the object and
 * streams it to a caller it has already authorised.
 */
export class R2ObjectStorage implements ObjectStorage {
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(settings: R2Settings) {
    this.client = new AwsClient({
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      service: 's3',
      region: 'auto',
      retries: 2,
    });
    // The account id is validated as 32 hex characters (env.schema), so it
    // cannot turn this into another host.
    this.base = `https://${settings.accountId}.r2.cloudflarestorage.com/${settings.bucket}/`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.client.fetch(this.urlOf(key), {
      method: 'PUT',
      body,
      headers: {
        'Content-Type': contentType,
        'X-Amz-Content-Sha256': createHash('sha256').update(body).digest('hex'),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Object storage refused the write (${response.status}).`);
  }

  async get(key: string): Promise<Readable> {
    const response = await this.client.fetch(this.urlOf(key), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Object storage could not read the object (${response.status}).`);
    }
    return Readable.fromWeb(response.body as WebReadableStream);
  }

  private urlOf(key: string): string {
    assertStorageKey(key);
    return this.base + key;
  }
}
