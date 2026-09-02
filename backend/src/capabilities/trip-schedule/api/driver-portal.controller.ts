import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { DriverPortalService } from '../application/driver-portal.service';
import { TripCompletionService } from '../application/trip-completion.service';
import { TripCostService } from '../application/trip-cost.service';
import { TripExecutionService } from '../application/trip-execution.service';
import type { DriverTrip, DriverTripDetail } from '../domain/driver-read-model';
import type { TripCost } from '../domain/trip-cost';
import {
  EXECUTION_EVENT_TYPES,
  EXPENSE_DECLARATIONS,
  type CompletionRequest,
  type ExecutionEvent,
} from '../domain/trip-execution';
import { isRecordableAmount, TRIP_COST_CATEGORIES } from '../domain/trip-cost';
import { ActiveAssignmentGuard } from './active-assignment.guard';

/**
 * The Driver Portal's whole API surface.
 *
 * ★ ITS OWN CONTROLLER AND ITS OWN GUARD, FOR THE SAME REASON `TripCostController`
 * is separate from `TripScheduleController`: the authorization question is
 * different, and mixing routes that answer different questions into one file is
 * how a route ends up behind the wrong decorator.
 *
 * ★ NO `@RequirePermission` ANYWHERE BELOW, AND THAT IS DELIBERATE.
 *
 * Every permission tier the system has answers "what is this caller's relation
 * to a DEPARTMENT". A driver's authority is a relation to a ROW — the active
 * assignment on the trip in the route — so there is no key and no tier that
 * would say anything true here. Declaring one anyway would be worse than
 * declaring none: `trip.write` is `head-anywhere` and would let a driver edit
 * every trip in the company, and `cost.create` is `global` and would hand them
 * the cost base. `ActiveAssignmentGuard` asks the only question that matters,
 * and it applies the `mustChangeSecret` gate `PermissionGuard` would have.
 *
 * ★ EVERY WRITE CARRIES `:tripId` IN THE PATH. Not in the body — a body that
 * named its own trip would let a driver assigned to one trip act on any other,
 * and the guard would have checked the wrong thing entirely.
 *
 * ★ AND THE SERVICES CHECK AGAIN. Each one re-resolves the active assignment
 * under a row lock inside its own transaction and refuses a mismatch. The guard
 * can be forgotten on a route; the service cannot be bypassed by one.
 */

/** The same shape the cost routes use. Text, never `z.number()` — see below. */
const amount = z
  .string()
  .trim()
  .refine(isRecordableAmount, 'Expected a positive amount, e.g. "1500000.00".');

const note = z.string().trim().max(2000).nullable().optional();

/**
 * ★ NO BUSINESS TIMESTAMP IS ACCEPTED FROM A CLIENT. NONE.
 *
 * This schema used to take `actualAt`, on the reasoning that the driver was
 * there and the server was not. That was wrong, and wrong in the direction that
 * corrupts the figures quietly: `actual_at` is what every delay is measured
 * from, so a handset whose clock is an hour out writes an hour of lateness that
 * nobody caused — or erases an hour that somebody did. A phone's clock is set by
 * the phone's owner.
 *
 * So the SERVER stamps `actual_at` when the tap arrives, exactly as it already
 * stamps `recorded_at`. With no offline queue the two are moments apart, and the
 * one that can be trusted is the one nobody outside the building can set.
 *
 * `deviceReportedAt` remains, and is the ONLY place a client clock is recorded.
 * It is DIAGNOSTIC — kept so a disagreement can be investigated, never read by
 * anything that computes a delay, an order or a KPI.
 */
const recordEventSchema = z.object({
  type: z.enum(EXECUTION_EVENT_TYPES),
  /** What the handset's own clock said. Diagnostic only; never operational truth. */
  deviceReportedAt: z.coerce.date().nullable().optional(),
  /** Idempotency. A retry on a bad connection must collide with its first attempt. */
  clientEventId: z.string().trim().min(1).max(200),
});

const declareExpenseSchema = z.object({
  category: z.enum(TRIP_COST_CATEGORIES),
  amount,
  note,
  clientRequestId: z.string().trim().min(1).max(200).nullable().optional(),
});

/**
 * The patch.
 *
 * `.partial()` of the fields a driver may correct — and `category`, `amount` and
 * `note` are the whole list. There is no way to move a line to another trip, and
 * no way to change who declared it.
 */
const editExpenseSchema = z.object({
  category: z.enum(TRIP_COST_CATEGORIES).optional(),
  amount: amount.optional(),
  note,
});

/**
 * ★ THE DECLARATION IS REQUIRED, WITH NO DEFAULT.
 *
 * Zero cost lines is not an answer: it is either a trip that cost nothing or a
 * driver who forgot, and only the driver can tell them apart. A default here —
 * any default — would be the system answering on their behalf. Contract §9.7.
 */
const submitCompletionSchema = z.object({
  expenseDeclaration: z.enum(EXPENSE_DECLARATIONS),
});

type RecordEventBody = z.infer<typeof recordEventSchema>;
type DeclareExpenseBody = z.infer<typeof declareExpenseSchema>;
type EditExpenseBody = z.infer<typeof editExpenseSchema>;
type SubmitCompletionBody = z.infer<typeof submitCompletionSchema>;

@Controller('driver')
export class DriverPortalController {
  constructor(
    private readonly portal: DriverPortalService,
    private readonly execution: TripExecutionService,
    private readonly money: TripCostService,
    private readonly completion: TripCompletionService,
  ) {}

  /**
   * The trips this driver is on.
   *
   * ★ NO `ActiveAssignmentGuard`, BECAUSE THERE IS NO `:tripId` TO CHECK. The
   * scope IS the session user: the query starts from their assignments, so
   * there is no id a caller could supply to widen it. That is why this route
   * takes no parameter at all.
   */
  @Get('trips')
  @UseGuards(AuthGuard)
  async listMyTrips(@CurrentUser() actor: SessionUser): Promise<DriverTrip[]> {
    return this.portal.listMyTrips(actor.id);
  }

  /** One trip, whitelisted — see `DriverTrip` for what is absent and why. */
  @Get('trips/:tripId')
  @UseGuards(AuthGuard, ActiveAssignmentGuard)
  async findMyTrip(
    @Param('tripId', UuidParam) tripId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverTripDetail> {
    return this.portal.findMyTrip(tripId, actor.id);
  }

  // ------------------------------------------------------------- execution ----

  /**
   * Reports an arrival or a confirmation.
   *
   * ★ THE BODY CARRIES NO TIME THE BUSINESS READS. `actual_at` and `recorded_at`
   * are both the server's, so a wrong phone clock cannot move a delay figure.
   *
   * 200 rather than 201 on a retry is not distinguished, on purpose: the driver
   * tapped once, and whether this request or its predecessor created the row is
   * not something they can act on.
   */
  @Post('trips/:tripId/execution-events')
  @UseGuards(AuthGuard, CsrfGuard, ActiveAssignmentGuard)
  async recordEvent(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(recordEventSchema)) body: RecordEventBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<ExecutionEvent> {
    return this.execution.recordEvent({
      ...body,
      tripId,
      // From the session, never the body. A body that named its own author is a
      // body that can name somebody else's — and `actualAt` is absent for the
      // same reason: it would be a body that named its own clock.
      recordedBy: actor.id,
    });
  }

  // --------------------------------------------------------------- expense ----

  @Post('trips/:tripId/expenses')
  @UseGuards(AuthGuard, CsrfGuard, ActiveAssignmentGuard)
  async declareExpense(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(declareExpenseSchema)) body: DeclareExpenseBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripCost> {
    return this.money.declareCost({ ...body, tripId, declaredBy: actor.id });
  }

  /**
   * Corrects a figure that has not been locked yet.
   *
   * PATCH rather than a void-and-replace, and only for a DRIVER-declared line:
   * a mistyped digit at a fuel station should not leave two rows and a void
   * reason reading "typo". A backoffice line keeps 0012's rule and is refused
   * here by the service.
   */
  @Patch('trips/:tripId/expenses/:costId')
  @UseGuards(AuthGuard, CsrfGuard, ActiveAssignmentGuard)
  async editExpense(
    @Param('tripId', UuidParam) tripId: string,
    @Param('costId', UuidParam) costId: string,
    @Body(new ZodValidationPipe(editExpenseSchema)) body: EditExpenseBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripCost> {
    return this.money.editCost(tripId, costId, body, actor.id);
  }

  // ------------------------------------------------------------ completion ----

  /**
   * Asks for the trip to be closed.
   *
   * Freezes every declared figure on the trip in the same transaction, so the
   * approver reads a total that cannot move underneath them. A rejection
   * reopens them all.
   */
  @Post('trips/:tripId/completion-requests')
  @UseGuards(AuthGuard, CsrfGuard, ActiveAssignmentGuard)
  async submitCompletion(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(submitCompletionSchema)) body: SubmitCompletionBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<CompletionRequest> {
    // Resubmitting after a rejection is this same route: the service writes a
    // NEW request with the next attempt number, carrying a NEW declaration.
    return this.completion.submit(tripId, actor.id, body.expenseDeclaration);
  }
}
