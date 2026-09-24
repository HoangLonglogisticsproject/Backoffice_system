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
 * ★ FACTS OUT, WINDOWS IN. `pickupBefore` / `submittedBefore` are technical
 * bounds the AI computes from ITS configuration; this side never knows what
 * "two hours" means. The routes are named for the facts they return, not for
 * the alerts the AI may raise from them — there is no `/trips-that-should-alert`.
 */

/** `?before=<ISO instant>&limit=&cursor=` — the instant is required and must parse. */
const windowQuerySchema = pageQuerySchema.extend({
  before: z.coerce.date({ invalid_type_error: 'before must be an ISO-8601 instant' }),
});
type WindowQueryInput = z.infer<typeof windowQuerySchema>;

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
    return this.readModel.unassignedTrips({ before: query.before, limit: query.limit, cursor: query.cursor });
  }

  @Get('unstarted-assignments')
  unstartedAssignments(
    @Query(new ZodValidationPipe(windowQuerySchema)) query: WindowQueryInput,
  ): Promise<Page<AssignmentFacts>> {
    return this.readModel.unstartedAssignments({ before: query.before, limit: query.limit, cursor: query.cursor });
  }

  @Get('pending-completions')
  pendingCompletions(
    @Query(new ZodValidationPipe(windowQuerySchema)) query: WindowQueryInput,
  ): Promise<Page<CompletionRequestFacts>> {
    return this.readModel.pendingCompletions({ before: query.before, limit: query.limit, cursor: query.cursor });
  }

  /** POST because a batch of ids does not fit a query string; 200 because nothing is created. */
  @Post('subjects/lookup')
  @HttpCode(200)
  lookup(@Body(new ZodValidationPipe(lookupBodySchema)) body: LookupBody): Promise<SubjectLookupResult> {
    return this.readModel.lookup(body);
  }
}
