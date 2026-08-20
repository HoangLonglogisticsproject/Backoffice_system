import { z } from 'zod';
import { DEFAULT_LIMIT, MAX_LIMIT } from './cursor';

/**
 * `?limit=&cursor=` for every paginated list.
 *
 * One schema rather than one per endpoint: the five lists differ in what they
 * sort by, not in how a caller asks for a page, and five copies of this would
 * be five places for the maximum to drift.
 *
 * Validated with the zod already used for bodies and the environment, so a bad
 * page request produces the same `422 VALIDATION_FAILED` envelope as a bad
 * body — one contract for the client to handle rather than two.
 */
export const pageQuerySchema = z.object({
  /**
   * Coerced because query strings are always strings. `.int()` rejects `1.5`
   * and `.max(MAX_LIMIT)` refuses the request rather than silently clamping:
   * a caller who asks for 5,000 rows has misunderstood something, and quietly
   * handing back 200 hides that until it matters.
   */
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),

  /**
   * Absent means the first page. Present and malformed is an error, not a
   * silent restart — see `decodeCursor` for why that distinction matters.
   *
   * The empty string is treated as absent, because `?cursor=` is what a client
   * sends when it forwards a `nextCursor` of `null` without checking.
   */
  cursor: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value)),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;
