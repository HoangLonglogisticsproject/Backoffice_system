import type { Readable } from 'node:stream';

/**
 * Where uploaded files live — never in PostgreSQL, never at a public URL.
 *
 * ★ NO DELETE, ON PURPOSE. Evidence is retired, never removed (0037), and an
 * object a row may still name must not be one call away from vanishing. A key
 * is content-addressed by its caller, so writing the same bytes twice is the
 * same object, and `put` may be repeated safely.
 *
 * Reads go through the backend, which decides who may see what before a byte
 * is fetched. Nothing here mints a URL a browser could keep.
 */
export interface ObjectStorage {
  /** Stores `body` under `key`. Idempotent for identical bytes. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The object's bytes, streamed. Rejects when the key does not exist. */
  get(key: string): Promise<Readable>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
