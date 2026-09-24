import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import type { Page } from '../../../common/pagination/cursor';
import { pageQuerySchema } from '../../../common/pagination/page-query.dto';
import { ServiceAuthGuard } from '../../../infrastructure/service-auth/service-auth.guard';
import { AiReadModelService } from '../application/ai-read-model.service';
import type { AssignmentFacts, CompletionRequestFacts, SubjectLookupResult, TripFacts } from '../domain/ai-read-model';
import { LOOKUP_LIMIT } from '../persistence/ai-read-model.repository';

/**
 * `/internal/v1/read-models/dispatch/*` — what the AI Platform reads.
 *
 * ★ A MACHINE CALLS THIS, AND ONLY A MACHINE. `ServiceAuthGuard` on the
 * class: the AI presents `SERVICE_TOKEN_AI_TO_BACKEND`, nothing else is
 * accepted, and there is no session, no CSRF and no `PermissionGuard`
 * because there is no person. The reverse proxy answers 404 for
 * `/api/internal/` on every public host, so this is reachable over the
 * compose network alone; the guard is the boundary, the network is depth.
 *
 * ★ FACTS OUT, WINDOWS IN. The window bounds are technical instants the AI
 * computes from ITS configuration; this side never knows what "two hours"
 * means, nor which side of a bound is the urgent one. The routes are named for the facts they return, not for
 * the alerts the AI may raise from them — there is no `/trips-that-should-alert`.
 */

/**
 * `?before=<ISO>&after=<ISO>&beforeInclusive=&afterInclusive=&limit=&cursor=`
 * — `before` is required, the rest optional. The two bounds and their two
 * inclusivity flags describe ONE interval; the defaults (`before` in, `after`
 * out) keep the half-open `(after, before]` a caller gets by saying nothing.
 *
 * A caller walking adjacent bands sets the flags so that the instant at the
 * join lands in exactly one of them — which one is the caller's decision,
 * and expressing it here is what keeps it from being expressed by nudging a
 * timestamp by a millisecond.
 */
const flag = z.enum(['true', 'false'], { invalid_type_error: 'must be exactly "true" or "false"' }).optional();

/** `?flag=true` → `true`, `?flag=false` → `false`, absent → the repository's default. */
const asBoolean = (value: 'true' | 'false' | undefined): boolean | undefined =>
  value === undefined ? undefined : value === 'true';

const windowQuerySchema = pageQuerySchema
  .extend({
    before: z.coerce.date({ invalid_type_error: 'before must be an ISO-8601 instant' }),
    after: z.coerce.date({ invalid_type_error: 'after must be an ISO-8601 instant' }).optional(),
    beforeInclusive: flag,
    afterInclusive: flag,
  })
  .refine((query) => query.after === undefined || !isEmptyRange(query), {
    message: 'the range described by after, before and their inclusivity flags is empty',
    path: ['after'],
  });
type WindowQueryInput = z.infer<typeof windowQuerySchema>;

/**
 * A range nothing could ever satisfy. `after > before` is one; so is
 * `after === before` unless BOTH ends are inclusive, which is the single
 * point `[t, t]`. Refused rather than answered with an empty page, because a
 * caller who asked for an impossible band has a bug and an empty page hides
 * it until the day the band should have had rows in it.
 */
const isEmptyRange = (query: {
  before: Date;
  after?: Date;
  beforeInclusive?: 'true' | 'false';
  afterInclusive?: 'true' | 'false';
}) => {
  if (query.after === undefined) return false;
  if (query.after > query.before) return true;
  if (query.after < query.before) return false;
  return !(query.afterInclusive === 'true' && query.beforeInclusive !== 'false');
};

const uuidList = z.array(z.string().uuid()).max(LOOKUP_LIMIT).default([]);
const lookupBodySchema = z.object({
  tripIds: uuidList,
  assignmentIds: uuidList,
  completionRequestIds: uuidList,
});
type LookupBody = z.infer<typeof lookupBodySchema>;

@Controller('internal/v1/read-models/dispatch')
@UseGuards(ServiceAuthGuard)
export class AiReadModelController {
  constructor(private readonly readModel: AiReadModelService) {}

  @Get('unassigned-trips')
  unassignedTrips(@Query(new ZodValidationPipe(windowQuerySchema)) query: WindowQueryInput): Promise<Page<TripFacts>> {
    return this.readModel.unassignedTrips({
      before: query.before,
      beforeInclusive: asBoolean(query.beforeInclusive),
      after: query.after,
      afterInclusive: asBoolean(query.afterInclusive),
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get('unstarted-assignments')
  unstartedAssignments(
    @Query(new ZodValidationPipe(windowQuerySchema)) query: WindowQueryInput,
  ): Promise<Page<AssignmentFacts>> {
    return this.readModel.unstartedAssignments({
      before: query.before,
      beforeInclusive: asBoolean(query.beforeInclusive),
      after: query.after,
      afterInclusive: asBoolean(query.afterInclusive),
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get('pending-completions')
  pendingCompletions(
    @Query(new ZodValidationPipe(windowQuerySchema)) query: WindowQueryInput,
  ): Promise<Page<CompletionRequestFacts>> {
    return this.readModel.pendingCompletions({
      before: query.before,
      beforeInclusive: asBoolean(query.beforeInclusive),
      after: query.after,
      afterInclusive: asBoolean(query.afterInclusive),
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /** POST because a batch of ids does not fit a query string; 200 because nothing is created. */
  @Post('subjects/lookup')
  @HttpCode(200)
  lookup(@Body(new ZodValidationPipe(lookupBodySchema)) body: LookupBody): Promise<SubjectLookupResult> {
    return this.readModel.lookup(body);
  }
}
