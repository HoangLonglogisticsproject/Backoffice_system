import { z } from 'zod';
import { pageQuerySchema } from '../../../common/pagination/page-query.dto';

/**
 * `?limit=&cursor=&membershipStatus=` — the query both roster reads accept.
 *
 * ONE definition, shared by the department-scoped read
 * (`GET /departments/:departmentId/members`) and the global one
 * (`GET /memberships`). They differ in WHICH rows the caller may see, which is
 * an authorization question their guards answer — never in how a caller asks
 * for a page. Two copies of this would be two places for the accepted values to
 * drift apart, and the one that drifted would be the one nobody re-read.
 *
 * ★ ABSENT MEANS BOTH, AND THE DEFAULT IS THE CLIENT'S. A server-side default of
 * `active` would make "Tất cả" impossible to ask for — there would be no value
 * meaning "do not filter". The screens send `membershipStatus=active` for their
 * default view; this schema only says which values are legal.
 *
 * The two values are `department_memberships.status`, not invented: 0003 CHECKs
 * the column against exactly this pair.
 */
export const rosterQuerySchema = pageQuerySchema.extend({
  membershipStatus: z.enum(['active', 'ended']).optional(),
});

export type RosterQuery = z.infer<typeof rosterQuerySchema>;
