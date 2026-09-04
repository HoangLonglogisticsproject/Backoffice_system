import { z } from 'zod';
import { pageQuerySchema } from '../../../common/pagination/page-query.dto';

/**
 * `?limit=&cursor=&status=` — the driver roster's query.
 *
 * ★ `status` IS `users.status`, NOT A MEMBERSHIP STATUS. The employee roster
 * filters on `department_memberships.status` (`active` / `ended`) because its
 * rows ARE memberships. A driver has none, so the only status a row here can
 * have is whether the account may operate — a different column answering a
 * different question, and the two must not be spelled the same.
 *
 * ★ ABSENT MEANS BOTH, and that is why there is no server-side default. A
 * default of `active` would leave no value meaning "do not filter", so the
 * screen's "Tất cả" option would be unaskable. The screen sends `active` for
 * its own default view; this schema only says which values are legal.
 *
 * The two values are the CHECK on `users.status`, not invented here.
 */
export const driverAccountQuerySchema = pageQuerySchema.extend({
  status: z.enum(['active', 'disabled']).optional(),
});

export type DriverAccountQuery = z.infer<typeof driverAccountQuerySchema>;
