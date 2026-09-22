import { z } from 'zod';
import { pageQuerySchema } from '../../../common/pagination/page-query.dto';
import { ALERT_SEVERITIES, ALERT_STATUSES, type AlertStatus } from '../domain/alert';

/**
 * `?status=open,acknowledged&severity=high&detectorCode=&tripId=&limit=&cursor=`
 *
 * A comma-separated list rather than a repeated parameter, so the backend
 * gateway can forward the query string it received untouched. Defaults to the
 * two statuses that are somebody's work: dismissed and resolved are asked for.
 */
const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((raw) => (raw ?? '').split(',').map((v) => v.trim()).filter((v) => v.length > 0))
    .pipe(z.array(z.enum(values as [T, ...T[]])));

export const alertQuerySchema = pageQuerySchema.extend({
  status: csv(ALERT_STATUSES).transform((list): AlertStatus[] => (list.length > 0 ? list : ['open', 'acknowledged'])),
  severity: csv(ALERT_SEVERITIES),
  detectorCode: z.string().trim().min(1).max(100).optional(),
  tripId: z.string().uuid().optional(),
});

export type AlertQuery = z.infer<typeof alertQuerySchema>;
