/**
 * The envelope every paginated list returns.
 *
 * The backend moved these lists from a bare array to a page, because the
 * unpaginated versions sequentially scanned and spilled sort to disk — the
 * department request and invitation lists carry no status filter and grow with
 * the deployment's age, so they had no natural bound at all.
 *
 * KEYSET, not offset: `nextCursor` is an opaque position, not a page number.
 * There is deliberately no total count — producing one costs the full scan that
 * pagination exists to avoid — so a client pages until `hasMore` is false and
 * never computes "page 7 of 41".
 */
export interface Page<T> {
  items: T[];
  /** Opaque. Hand it back verbatim; never construct or parse one. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** What a caller may ask for. `limit` defaults to 50 server-side, max 200. */
export interface PageRequest {
  limit?: number;
  /** Omit for the first page. A malformed value is a 422, not a silent restart. */
  cursor?: string;
}
