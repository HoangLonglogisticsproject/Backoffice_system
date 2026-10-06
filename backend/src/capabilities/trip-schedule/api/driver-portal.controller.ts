import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { ProvisionedAccountGuard } from '../../../core/authorization/api/provisioned-account.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import { DriverOnlyGuard } from '../../../core/identity/api/driver-only.guard';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { DriverPortalService } from '../application/driver-portal.service';
import { TripCompletionService } from '../application/trip-completion.service';
import { TripCostService } from '../application/trip-cost.service';
import { TripExecutionService } from '../application/trip-execution.service';
import { VehicleFuelService } from '../application/vehicle-fuel.service';
import type {
  DriverHistoryPage,
  DriverTrip,
  DriverTripDetail,
  DriverWorkday,
} from '../domain/driver-read-model';
import type { TripCost } from '../domain/trip-cost';
import {
  EXECUTION_EVENT_TYPES,
  EXPENSE_DECLARATIONS,
  type CompletionRequest,
  type ExecutionEvent,
} from '../domain/trip-execution';
import { isRecordableAmount, TRIP_COST_CATEGORIES } from '../domain/trip-cost';
import {
  forDriver,
  isRecordableLiters,
  type DailyFuelDeclaration,
  type DriverDailyFuelCheck,
  type DriverFuelTransaction,
} from '../domain/vehicle-fuel';
import { ActiveAssignmentGuard } from './active-assignment.guard';
import { ExpenseAssignmentGuard } from './expense-assignment.guard';
import { ReadableAssignmentGuard } from './readable-assignment.guard';

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
 * assignment in the route — so there is no key and no tier that would say
 * anything true here. Declaring one anyway would be worse than declaring none:
 * `trip.write` is `head-anywhere` and would let a driver edit every trip in
 * the company, and `cost.create` is `global` and would hand them the cost
 * base. `ActiveAssignmentGuard` asks the only question that matters, and it
 * applies the `mustChangeSecret` gate `PermissionGuard` would have.
 *
 * ★ EVERY ROUTE IS SCOPED BY `:assignmentId`, NEVER BY A TRIP (ADR-0004). One
 * driver may hold several turns on one trip — one per lorry — so a trip id
 * cannot say which lorry's progress is being reported. The assignment id can,
 * and the trip is derived from it server-side; no driver route accepts a trip
 * id from the client at all. In the path, not the body — a body that named its
 * own assignment would let a driver holding one turn act on any other, and the
 * guard would have checked the wrong thing entirely.
 *
 * ★ AND THE SERVICES CHECK AGAIN. Each one re-reads the assignment under a row
 * lock inside its own transaction and refuses a mismatch. The guard can be
 * forgotten on a route; the service cannot be bypassed by one.
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
/**
 * ★ A READING, AND NOTHING THAT LOOKS LIKE A VERDICT.
 *
 * Four fields: where, how sure, and when the handset says it took the fix.
 * There is no `geofencePassed`, no `distance`, no `isInside` — a client that
 * sends any of those has them stripped by this schema before the service sees
 * the body, and only the service may compute a distance, from the trip's own
 * coordinates. The browser is a sensor here, not a judge.
 *
 * ⚠ AND NOTHING MEASURES IT TODAY (DL-118). The geofence is off, so a reading
 * that arrives is stored beside the event with no verdict. The schema is kept
 * whole because validating a shape is cheap and re-deriving it is not.
 *
 * `z.number()` refuses `NaN` and a string; the bounds refuse the rest of what
 * is not a place. `capturedAt` is the handset's clock and is DIAGNOSTIC like
 * `deviceReportedAt`: it decides whether the fix is fresh, never when the
 * pickup happened.
 */
const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0),
  capturedAt: z.coerce.date(),
});

const recordEventSchema = z.object({
  type: z.enum(EXECUTION_EVENT_TYPES),
  /** What the handset's own clock said. Diagnostic only; never operational truth. */
  deviceReportedAt: z.coerce.date().nullable().optional(),
  /**
   * Where the handset was. OPTIONAL on every milestone, and the portal sends it
   * on none: the geofence is off (`GEOFENCED_MILESTONES`, DL-118). The field
   * stays so a reading can be accepted the day it is asked for again — and one
   * sent today is stored as evidence with no verdict.
   */
  location: locationSchema.nullable().optional(),
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
 * The lorry's daily fuel check (0034).
 *
 * ★ NO `vehicleId` AND NO DATE — the lorry is the assignment's and the day is
 * the server's; a body that sent either has it stripped here. `no_fuel` takes
 * nothing but its key: there is no 0-đồng cost to write. The key is required,
 * because the handset retries this on a weak signal and a double tap must not
 * become two fills.
 */
const clientRequestId = z.string().trim().min(1).max(200);

const fill = {
  amount,
  liters: z
    .string()
    .trim()
    .refine(isRecordableLiters, 'Expected a positive number of liters, e.g. "45.50".')
    .nullable()
    .optional(),
  odometerKm: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  note,
  clientRequestId,
};

const declareFuelCheckSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('fuel_added'), ...fill }),
  z.object({ outcome: z.literal('no_fuel'), clientRequestId }),
]);

/**
 * A fill after the day's check (`recordFuelFill`). The same readings as a
 * "Có đổ nhiên liệu" check and the same rule: no lorry, no day, no trip — the
 * server's. The key is required: a double tap must not become two fills.
 */
const recordFuelFillSchema = z.object(fill);

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

/**
 * One page of history.
 *
 * ★ A CEILING ON `limit`, BECAUSE THE CALLER PICKS IT. Without one, `?limit=1000000`
 * is a whole driver's history assembled in memory on request — cheap to ask for
 * and not cheap to serve. Fifty is more than a phone screen and small enough
 * that the worst case is uninteresting.
 *
 * ★ THE CURSOR IS TWO PARAMETERS, NOT AN ENCODED BLOB. A base64 token would
 * only be this pair with a step that hides it; plain parameters are readable in
 * a log and in a bug report, and they carry no authority either way — the query
 * filters on the session's driver id whatever the cursor says.
 *
 * Both halves or neither: half a cursor is a caller mistake, and silently
 * treating it as "first page" would show them a page they did not ask for.
 */
const historyQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.coerce.date().optional(),
    beforeId: z.string().uuid().optional(),
  })
  .refine((query) => (query.before === undefined) === (query.beforeId === undefined), {
    message: 'A page cursor needs both `before` and `beforeId`, or neither.',
  });

type HistoryQuery = z.infer<typeof historyQuerySchema>;
type RecordEventBody = z.infer<typeof recordEventSchema>;
type DeclareExpenseBody = z.infer<typeof declareExpenseSchema>;
type EditExpenseBody = z.infer<typeof editExpenseSchema>;
type SubmitCompletionBody = z.infer<typeof submitCompletionSchema>;
type DeclareFuelCheckBody = z.infer<typeof declareFuelCheckSchema>;
type RecordFuelFillBody = z.infer<typeof recordFuelFillSchema>;

/** The body's declaration, with the optional readings made explicit. */
const declarationOf = (body: DeclareFuelCheckBody): DailyFuelDeclaration =>
  body.outcome === 'no_fuel'
    ? { outcome: 'no_fuel' }
    : {
        outcome: 'fuel_added',
        amount: body.amount,
        liters: body.liters ?? null,
        odometerKm: body.odometerKm ?? null,
        note: body.note || null,
      };

@Controller('driver')
export class DriverPortalController {
  constructor(
    private readonly portal: DriverPortalService,
    private readonly execution: TripExecutionService,
    private readonly money: TripCostService,
    private readonly completion: TripCompletionService,
    private readonly fuel: VehicleFuelService,
  ) {}

  /**
   * The assignments this driver holds — one per lorry, grouped by trip on the
   * handset.
   *
   * ★ NO `ActiveAssignmentGuard`, BECAUSE THERE IS NO `:assignmentId` TO CHECK.
   * The scope IS the session user: the query starts from their assignments, so
   * there is no id a caller could supply to widen it. That is why this route
   * takes no parameter at all.
   *
   * ★ BUT THE PROVISIONING GATE STILL APPLIES. Without `ActiveAssignmentGuard`
   * nothing on this route loaded a context, so a driver still holding their
   * temporary password read every customer, address and cargo note on their
   * trips — the one thing the contract says they may not do before changing
   * it. `ProvisionedAccountGuard` is that gate on its own, and nothing more.
   */
  @Get('assignments')
  @UseGuards(AuthGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  async listMyAssignments(@CurrentUser() actor: SessionUser): Promise<DriverTrip[]> {
    return this.portal.listMyAssignments(actor.id);
  }

  /**
   * The trips this driver has already run to the end, newest first.
   *
   * ★ `driver/history`, NOT `driver/assignments/history`. The route below is
   * `assignments/:assignmentId`, and Nest matches in declaration order — a
   * literal segment sitting under a parameter route is read as an id, and
   * `UuidParam` then answers 400 for a word. Its own path cannot collide.
   *
   * ★ SAME GUARDS AS THE LIVE LIST, AND FOR THE SAME REASONS. No
   * `ActiveAssignmentGuard`: there is no `:assignmentId` to check, and the
   * scope IS the session user. `ProvisionedAccountGuard` still applies — a
   * driver holding a temporary password must not read addresses and cargo,
   * and past trips are no less readable than live ones.
   *
   * ★ THE CURSOR IS THE CALLER'S, NOT AN AUTHORITY. It only says where to
   * resume; the query filters on the session's driver id regardless, so a
   * forged cursor moves somebody's own window and nothing else.
   */
  /**
   * "Ca làm việc hôm nay" — the driver's lorries today, their fuel answer and
   * their turns. Scoped by the session like the list above: no parameter, so
   * nothing a caller sends can widen it.
   */
  @Get('workday')
  @UseGuards(AuthGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  async myWorkday(@CurrentUser() actor: SessionUser): Promise<DriverWorkday> {
    return this.portal.workday(actor.id);
  }

  @Get('history')
  @UseGuards(AuthGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  async listMyHistory(
    @Query(new ZodValidationPipe(historyQuerySchema)) query: HistoryQuery,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverHistoryPage> {
    return this.portal.listMyFinishedTrips(actor.id, {
      limit: query.limit,
      before:
        query.before && query.beforeId
          ? { assignedAt: query.before, id: query.beforeId }
          : null,
    });
  }

  /**
   * One assignment, whitelisted — see `DriverTrip` for what is absent and why.
   *
   * ★ `ReadableAssignmentGuard`, NOT `ActiveAssignmentGuard`: the only route
   * here that READS one turn. It opens every card either list shows — live
   * work, and a turn on a finished trip (`closed: true`). The routes below
   * act: reporting and completion keep the active-only guard, the two money
   * routes `ExpenseAssignmentGuard` (`expensesOpen` says which apply).
   */
  @Get('assignments/:assignmentId')
  @UseGuards(AuthGuard, DriverOnlyGuard, ReadableAssignmentGuard)
  async findMyAssignment(
    @Param('assignmentId', UuidParam) assignmentId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverTripDetail> {
    return this.portal.findMyAssignment(assignmentId, actor.id);
  }

  // ------------------------------------------------------------- execution ----

  /**
   * Reports an arrival or a confirmation on one assignment.
   *
   * ★ THE BODY CARRIES NO TIME THE BUSINESS READS. `actual_at` and `recorded_at`
   * are both the server's, so a wrong phone clock cannot move a delay figure.
   *
   * 200 rather than 201 on a retry is not distinguished, on purpose: the driver
   * tapped once, and whether this request or its predecessor created the row is
   * not something they can act on.
   */
  @Post('assignments/:assignmentId/execution-events')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ActiveAssignmentGuard)
  async recordEvent(
    @Param('assignmentId', UuidParam) assignmentId: string,
    @Body(new ZodValidationPipe(recordEventSchema)) body: RecordEventBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<ExecutionEvent> {
    return this.execution.recordEvent({
      ...body,
      assignmentId,
      // From the session, never the body. A body that named its own author is a
      // body that can name somebody else's — and `actualAt` is absent for the
      // same reason: it would be a body that named its own clock.
      recordedBy: actor.id,
    });
  }

  // --------------------------------------------------------------- expense ----

  /**
   * Declares a figure on one assignment.
   *
   * ★ `ExpenseAssignmentGuard`, NOT THE ACTIVE-ONLY ONE: the two money routes
   * also admit a turn recorded after the run, whose driver backfills what it
   * cost. Which of a driver's turns may take money, and when, is
   * `driverExpenseScope` — the guard, the service and the read model's
   * `expensesOpen` all ask it. Reporting and completion stay active-only.
   */
  @Post('assignments/:assignmentId/expenses')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ExpenseAssignmentGuard)
  async declareExpense(
    @Param('assignmentId', UuidParam) assignmentId: string,
    @Body(new ZodValidationPipe(declareExpenseSchema)) body: DeclareExpenseBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripCost> {
    return this.money.declareCost({ ...body, assignmentId, declaredBy: actor.id });
  }

  /**
   * Corrects a figure that has not been locked yet.
   *
   * PATCH rather than a void-and-replace, and only for a DRIVER-declared line:
   * a mistyped digit at a fuel station should not leave two rows and a void
   * reason reading "typo". A backoffice line keeps 0012's rule and is refused
   * here by the service.
   */
  @Patch('assignments/:assignmentId/expenses/:costId')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ExpenseAssignmentGuard)
  async editExpense(
    @Param('assignmentId', UuidParam) assignmentId: string,
    @Param('costId', UuidParam) costId: string,
    @Body(new ZodValidationPipe(editExpenseSchema)) body: EditExpenseBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripCost> {
    return this.money.editCost(assignmentId, costId, body, actor.id);
  }

  // ------------------------------------------------------------ fuel check ----

  /**
   * Answers the lorry's daily fuel check — "Khai nhiên liệu đầu ca".
   *
   * ★ `ActiveAssignmentGuard`: only a live turn starts, so only a live turn
   * owes the check. A turn recorded after the run never starts and never asks.
   * The answer is the check that stands for the lorry today — possibly another
   * driver's — told as the day and the outcome only (`forDriver`).
   */
  @Post('assignments/:assignmentId/fuel-checks')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ActiveAssignmentGuard)
  async declareFuelCheck(
    @Param('assignmentId', UuidParam) assignmentId: string,
    @Body(new ZodValidationPipe(declareFuelCheckSchema)) body: DeclareFuelCheckBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverDailyFuelCheck> {
    const check = await this.fuel.declare({
      assignmentId,
      declaration: declarationOf(body),
      clientRequestId: body.clientRequestId,
      declaredBy: actor.id,
    });
    return forDriver(check);
  }

  /**
   * Records a fill after the day's check — "Ghi nhận đổ nhiên liệu" — on the
   * turn's lorry, as one more row of its ledger (`VehicleFuelService.recordFill`).
   *
   * ★ `ActiveAssignmentGuard` DOES NOT REFUSE THE DRIVER WHO FINISHED TODAY:
   * approval never ends a turn, so the turn of a closed trip is still active
   * and still theirs. What it refuses is an ended turn — ended before its first
   * milestone, or a run recorded after the fact — which never ran on a day
   * this route can fill. Whether the turn is the driver's work TODAY is the
   * service's question, asked under the trip lock.
   */
  @Post('assignments/:assignmentId/fuel-transactions')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ActiveAssignmentGuard)
  async recordFuelFill(
    @Param('assignmentId', UuidParam) assignmentId: string,
    @Body(new ZodValidationPipe(recordFuelFillSchema)) body: RecordFuelFillBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverFuelTransaction> {
    return this.fuel.recordFill({
      assignmentId,
      fill: {
        amount: body.amount,
        liters: body.liters ?? null,
        odometerKm: body.odometerKm ?? null,
        note: body.note || null,
      },
      clientRequestId: body.clientRequestId,
      recordedBy: actor.id,
    });
  }

  // ------------------------------------------------------------ completion ----

  /**
   * Asks for this assignment's turn to be closed.
   *
   * Freezes every figure declared on THIS assignment in the same transaction,
   * so the approver reads a total that cannot move underneath them. A rejection
   * reopens them all. Another lorry on the same trip is untouched.
   */
  @Post('assignments/:assignmentId/completion-requests')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ActiveAssignmentGuard)
  async submitCompletion(
    @Param('assignmentId', UuidParam) assignmentId: string,
    @Body(new ZodValidationPipe(submitCompletionSchema)) body: SubmitCompletionBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<CompletionRequest> {
    // Resubmitting after a rejection is this same route: the service writes a
    // NEW request with the next attempt number, carrying a NEW declaration.
    return this.completion.submit(assignmentId, actor.id, body.expenseDeclaration);
  }
}
