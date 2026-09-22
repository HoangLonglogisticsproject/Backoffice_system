import { z } from 'zod';
import { DEFAULT_LIMIT, MAX_LIMIT } from './cursor';

/** `?limit=&cursor=` for every paginated list — the backend's shape. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value)),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;
