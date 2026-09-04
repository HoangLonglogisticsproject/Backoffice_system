import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  dateRangePageQuerySchema,
  type DateRangePageQuery,
} from '../../../common/pagination/date-range-page-query.dto';
import type { OffsetPage } from '../../../common/pagination/offset-page';
import { pageQuerySchema, type PageQuery } from '../../../common/pagination/page-query.dto';
import type { Page } from '../../../common/pagination/cursor';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { OperationalBoardService } from '../application/operational-board.service';
import { TripExecutionService } from '../application/trip-execution.service';
import { TripScheduleService, type TripBoardQuery } from '../application/trip-schedule.service';
import type { OperationalBoardRow } from '../domain/operational-board';
import type { UserSummary } from '../../../common/types/user-summary';
import type {
  DriverAssignment,
  DriverTripHistoryRow,
  ExecutionEvent,
} from '../domain/trip-execution';
import type { TripStatusChange } from '../domain/trip-status-history';
import {
  TRIP_ASSIGNMENT_FILTERS,
  TRIP_STATUSES,
  type TripSchedule,
  type TripScheduleWithRefs,
} from '../domain/trip-schedule';

/**
 * The dispatch board.
 *
 * ★ THIS RESOURCE HAS NO DEPARTMENT, AND THE ROUTES SHOW IT. Every other list
 * in this API hangs off `/departments/:departmentId/…` because its scope IS a
 * department. A trip belongs to the company: the truck is the company's, the
 * customer is the company's, and dispatch is not a unit anybody is a member of.
 * Inventing a department to scope it to would be inventing a fact.
 *
 * ⚠ THAT DOES NOT MEAN THE ROUTES ARE UNGUARDED, and the reason is easy to get
 * wrong. Every handler below runs `PermissionGuard` even though the permission
 * it names is held by everybody, because `PermissionGuard` is ALSO where
 * `mustChangeSecret` is refused. Dropping it for a bare `AuthGuard` would let
 * somebody still holding a temporary credential read and write the board — the
 * one thing §12 of the frontend contract promises cannot happen.
 *
 *   reading, adding    trip.read / trip.create   — any finished account
 *   correcting, archiving   trip.write           — global only
 *
 * The asymmetry is deliberate. The workbook let anybody type anything, which is
 * how it filled up with two spellings of the same truck; correcting somebody
 * else's row rewrites what the record appears to say, and that is
 * administration.
 */

/**
 * ★ `.nullable()` ON EIGHT FIELDS AND NOT ON TWO, AND THE DIFFERENCE MATTERS.
 *
 * On the PATCH below, `undefined` means "leave this alone" and `null` means
 * "clear it". zod preserves that distinction only if the schema admits `null`
 * as a value — an `.optional()` field that is not `.nullable()` turns an
 * explicit null into a validation error, and the field could then never be
 * emptied once filled.
 *
 * `scheduledOn` and `status` are `.optional()` WITHOUT `.nullable()` on purpose:
 * their columns are NOT NULL, so there is no "cleared" state to express.
 */
const text = z.string().trim().max(4000).nullable();

/**
 * A day on the board.
 *
 * Refused as a plain string rather than coerced to a `Date`. `new Date('2026-08-04')`
 * is midnight UTC, which is the previous evening in Hồ Chí Minh — the same
 * off-by-one-day the repository casts to text to avoid, arriving from the other
 * direction.
 */
const boardDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'That date does not exist.');

/** A full instant. Pickup and delivery are timestamps, not times of day. */
const instant = z.coerce.date().nullable();

const tripStatus = z.enum(TRIP_STATUSES);

/**
 * ★ NO COORDINATE FIELD ON THE TRIP, ANYWHERE. A dispatcher names the
 * customer's PLACE; the service copies that place's address, contact and
 * coordinates onto the trip. A body that typed a latitude would be a body that
 * could type the wrong one, and it is refused by absence: the schema has no
 * field for it, so it is stripped before the service sees anything.
 */
const locationId = z.string().uuid().nullable();

const createTripSchema = z.object({
  // The only required field. A trip with no day is not on the board at all.
  scheduledOn: boardDay,

  vehicleId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),

  cargoInfo: text.optional(),
  pickupAddress: text.optional(),
  deliveryAddress: text.optional(),
  pickupContact: text.optional(),
  deliveryContact: text.optional(),

  pickupAt: instant.optional(),
  deliveryAt: instant.optional(),

  pickupLocationId: locationId.optional(),
  deliveryLocationId: locationId.optional(),

  note: text.optional(),
  status: tripStatus.optional(),
});

/**
 * The patch.
 *
 * `.partial()` of the create schema, which is exactly right here: it makes
 * `scheduledOn` optional without making it nullable, and leaves the eight
 * nullable fields nullable — so "leave alone" and "clear" stay distinguishable
 * on every field where clearing is a real thing to want.
 *
 * An empty body is legal and changes nothing. A strange request, but not a
 * wrong one, and answering 422 to it would force every client to work out which
 * of its own fields are dirty before it may send any of them.
 */
const updateTripSchema = createTripSchema.partial();

/**
 * A board move, optionally explained.
 *
 * `reason` is optional because most moves are routine and forcing a sentence
 * onto each of them produces a column full of "ok" — the opposite of an audit
 * trail. It is accepted because the moves that ARE worth explaining, such as
 * sending a trip backwards, are the ones somebody asks about later.
 */
/**
 * `?includeVoided=true`.
 *
 * An enum rather than a boolean, and NOT coerced — `z.coerce.boolean()` is a
 * trap here, because `Boolean("false")` is `true`. The same spelling the cost
 * and catalogue routes use.
 */
const includeVoidedSchema = z.object({ includeVoided: z.enum(['true', 'false']).optional() });

/**
 * `?assignment=unassigned` — the board, narrowed to the trips still missing a driver.
 *
 * ★ A FILTER, NOT A SIXTH STATUS, and the split matters on this screen. Dispatch
 * works the uncrewed trips as a QUEUE: a row joins it the moment it is entered
 * and leaves it the moment somebody is put on it, whatever the cargo's status
 * says. Encoding that as a status would have made "đợi xe, tài xế đã có" and
 * "đợi xe, chưa có ai" the same word.
 *
 * ★ AND IT IS ANSWERED IN SQL. The alternative — hand back the page and let the
 * browser drop the crewed rows — is the mistake `TripSchedulePage` already
 * warns about: a page is not the result set, so filtering it client-side hides
 * rows without saying so and leaves the total describing a different list.
 *
 * `all` by default, so a caller that has never heard of this parameter reads
 * exactly the board it read before.
 */
const boardFilterSchema = z.object({
  assignment: z.enum(TRIP_ASSIGNMENT_FILTERS).default('all'),
});

/**
 * The dispatch list's query: the shared range-and-page DTO, plus the crew filter.
 *
 * An intersection rather than an `.extend()` because `dateRangePageQuerySchema`
 * ends in a transform and two refinements — it is no longer a `ZodObject` and
 * has no `.extend()`. Intersecting parses the same query string with both and
 * merges the results, which keeps every guarantee ADR-0003 rests on inside the
 * one schema that states it.
 */
const boardQuerySchema = dateRangePageQuerySchema.and(boardFilterSchema);

/**
 * Putting a driver on a trip, or taking one off.
 *
 * `driverUserId` is the ONLY thing a caller names; whether that account is a
 * driver, is live, and whether the trip is still open are the service's to
 * decide under its lock. A reason is required on a change and on a removal
 * — an ended turn with no explanation is the row nobody can account for.
 */
const assignDriverSchema = z.object({ driverUserId: z.string().uuid() });
const replaceDriverSchema = z.object({
  driverUserId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
});
const endAssignmentSchema = z.object({ reason: z.string().trim().min(1).max(2000) });

type AssignDriverBody = z.infer<typeof assignDriverSchema>;
type ReplaceDriverBody = z.infer<typeof replaceDriverSchema>;
type EndAssignmentBody = z.infer<typeof endAssignmentSchema>;

type IncludeVoidedQuery = z.infer<typeof includeVoidedSchema>;

const updateStatusSchema = z.object({
  status: tripStatus,
  reason: z.string().trim().min(1).max(500).nullable().optional(),
});

type CreateTripBody = z.infer<typeof createTripSchema>;
type UpdateTripBody = z.infer<typeof updateTripSchema>;
type UpdateStatusBody = z.infer<typeof updateStatusSchema>;

@Controller()
export class TripScheduleController {
  constructor(
    private readonly trips: TripScheduleService,
    private readonly operations: OperationalBoardService,
    private readonly execution: TripExecutionService,
  ) {}

  /**
   * What is actually happening, for the people who have to chase it.
   *
   * ★ DECLARED BEFORE `:tripId`, and the ordering is load-bearing — Nest matches
   * in declaration order, so below it this literal would be parsed as a trip id
   * and `UuidParam` would reject it.
   *
   * `trip.read`, the same permission as the board itself: this is dispatch
   * information throughout. It names the driver and how late they are — which is
   * exactly what the DRIVER's own read model must not carry about anybody — and
   * it carries no money at all: the expense declaration is a `none`/`expenses`
   * word, never an amount.
   *
   * ⚠ THE DATE RANGE IS MANDATORY AND CAPPED, by the same DTO the dispatch list
   * uses and for the same reason ADR-0003 gives.
   */
  @Get('operational-board')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async operationalBoard(
    @Query(new ZodValidationPipe(dateRangePageQuerySchema)) query: DateRangePageQuery,
  ): Promise<OperationalBoardRow[]> {
    return this.operations.list(query);
  }

  /**
   * One page of the board.
   *
   * Returns `{ items, page, limit, total, totalPages }` — NOT the
   * `{ items, nextCursor, hasMore }` every other list returns. It is the one
   * exception in the API, it exists because dispatch needs "page 2 of 3" and a
   * count for the month, and it is only defensible while the date range stays
   * mandatory and capped. ADR-0003 has the argument in full.
   */
  /**
   * Every completion still waiting on a decision, whatever month the trip ran.
   *
   * ★ NO DATE RANGE, UNLIKE EVERY OTHER TRIP LIST, and that is the fix rather
   * than an inconsistency. The board is a view of a PERIOD; this is a view of
   * OUTSTANDING WORK. Filtering it by `scheduled_on` made a completion
   * submitted on the 30th disappear from the queue on the 1st — while nobody
   * had decided it.
   *
   * Bounded without a range for the reason ADR-0002 §4 gives for the short
   * lists: one pending request per trip, and a decided trip leaves the set.
   * A queue that grows long is the alarm, and hiding it behind a filter would
   * silence exactly that.
   *
   * `trip.read`, like the board: no money rides on this response.
   */
  @Get('completion-review-queue')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async completionReviewQueue(): Promise<OperationalBoardRow[]> {
    return this.operations.listUnresolvedCompletions();
  }

  @Get('trip-schedules')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async list(
    @Query(new ZodValidationPipe(boardQuerySchema)) query: TripBoardQuery,
  ): Promise<OffsetPage<TripScheduleWithRefs>> {
    return this.trips.list(query);
  }

  @Get('trip-schedules/:tripId')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async findOne(
    @Param('tripId', UuidParam) tripId: string,
  ): Promise<TripScheduleWithRefs> {
    return this.trips.findById(tripId);
  }

  @Post('trip-schedules')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.create')
  async create(
    @Body(new ZodValidationPipe(createTripSchema)) body: CreateTripBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripSchedule> {
    // `createdBy` from the session, never from the body. A body that names its
    // own author is a body that can name somebody else's.
    return this.trips.create({ ...body, createdBy: actor.id });
  }

  @Patch('trip-schedules/:tripId')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  async update(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(updateTripSchema)) body: UpdateTripBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripSchedule> {
    // The actor is passed because this route can move the status too — `status`
    // is a field of the patch — and every board move is recorded with whoever
    // made it.
    return this.trips.update(tripId, body, actor.id);
  }

  /**
   * Moving a row along the board — its own route, not a field on the PATCH.
   *
   * Two reasons, and neither is tidiness. It is the write dispatch performs
   * many times a day, so it is worth being cheap and unambiguous; and it is the
   * one edit that is plausibly NOT administration. Keeping it separate means
   * relaxing it later — letting whoever is on shift mark a trip delivered — is
   * a change to one decorator rather than a redesign of the edit path.
   */
  @Patch('trip-schedules/:tripId/status')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  async updateStatus(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(updateStatusSchema)) body: UpdateStatusBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripSchedule> {
    return this.trips.updateStatus(tripId, body.status, actor.id, body.reason ?? null);
  }

  /**
   * Every move this trip has made, and who made it.
   *
   * `trip.read`, the same permission as the board itself: this is dispatch
   * information and carries no money. The author's NAME rides along because a
   * UUID cannot be shown to anybody.
   */
  @Get('trip-schedules/:tripId/status-history')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async statusHistory(
    @Param('tripId', UuidParam) tripId: string,
  ): Promise<TripStatusChange[]> {
    return this.trips.statusHistory(tripId);
  }

  /**
   * What the driver reported on this trip, in the order it happened.
   *
   * ★ ADDED FOR THE COMPLETION REVIEW, AND IT READS WHAT ALREADY EXISTS. The
   * operational board carries the four DERIVED times; a reviewer deciding
   * whether to close a trip needs the events themselves — when the server heard
   * each one, whether any was withdrawn and why. Nothing else exposed that.
   *
   * `trip.read`, the same permission as the board: an execution event carries no
   * money. `includeVoided=true` shows the withdrawn ones, which is exactly what
   * somebody auditing a correction is looking for.
   */
  @Get('trip-schedules/:tripId/execution-events')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async executionEvents(
    @Param('tripId', UuidParam) tripId: string,
    @Query(new ZodValidationPipe(includeVoidedSchema)) query: IncludeVoidedQuery,
  ): Promise<ExecutionEvent[]> {
    return this.execution.listEvents(tripId, query.includeVoided === 'true');
  }

  // ------------------------------------------------------- driver assignment --

  /**
   * Who may be put on a trip: every live driver account, id and name.
   *
   * ★ `trip.write`, THE SAME AUTHORITY THAT ASSIGNS. A list of the company's
   * drivers is dispatch information; the people who hold it are the people who
   * dispatch. Declared before `trip-schedules/:tripId` as a matter of habit —
   * the prefixes differ, so the order is not load-bearing here.
   */
  @Get('trip-drivers')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  async eligibleDrivers(): Promise<UserSummary[]> {
    return this.execution.listEligibleDrivers();
  }

  /**
   * What ONE driver has been given, newest first — ended turns included.
   *
   * ★ THE MIRROR OF `trip-schedules/:tripId/driver-assignments`, AND IT CARRIES
   * THE SAME KEY. That route reads the turns of one trip; this reads the turns
   * of one driver. They are the same rows asked from opposite ends, so guarding
   * them differently would mean the same fact were readable or not depending on
   * which way somebody phrased the question. History, so `trip.read` — and the
   * board already tells every `trip.read` holder who drove which trip.
   *
   * ★ DECLARED AFTER `trip-drivers`, and the order is not load-bearing: the
   * prefixes differ, so neither can swallow the other. It is next to it because
   * that is where a reader will look for it.
   *
   * ⚠ NO MONEY, BY CONSTRUCTION. The query behind this joins neither cost table,
   * so there is no amount in the result set for a future mapper to pass through.
   */
  @Get('trip-drivers/:driverUserId/trips')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async driverTrips(
    @Param('driverUserId', UuidParam) driverUserId: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Page<DriverTripHistoryRow>> {
    return this.execution.listDriverHistory(driverUserId, query);
  }

  /** Every turn on this trip, newest first. History, so `trip.read`. */
  @Get('trip-schedules/:tripId/driver-assignments')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async assignments(@Param('tripId', UuidParam) tripId: string): Promise<DriverAssignment[]> {
    return this.execution.listAssignments(tripId);
  }

  /**
   * Puts a driver on a trip that has none.
   *
   * ★ `trip.write` — GLOBAL, OR THE HEAD OF ANY DEPARTMENT — and no new key.
   * Assigning a driver is a correction to the board of exactly the kind
   * `trip.write` already governs (who is on the row), held by the same senior
   * people dispatch escalates to, and by nobody else: `BackofficeOnlyGuard`
   * refuses a driver account before the permission is even asked, so a driver
   * cannot put themselves or anybody else on a trip.
   *
   * 409 when the trip already has a driver: replacing is its own route with
   * its own reason, so a second assignment can never silently become one.
   */
  @Post('trip-schedules/:tripId/driver-assignments')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  async assignDriver(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(assignDriverSchema)) body: AssignDriverBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverAssignment> {
    return this.execution.assign(tripId, body.driverUserId, actor.id);
  }

  /** Swaps the driver. The previous turn is ended with the reason, never erased. */
  @Post('trip-schedules/:tripId/driver-assignments/replace')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  @HttpCode(HttpStatus.OK)
  async replaceDriver(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(replaceDriverSchema)) body: ReplaceDriverBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverAssignment> {
    return this.execution.replaceDriver(tripId, body.driverUserId, {
      by: actor.id,
      reason: body.reason,
    });
  }

  /** Takes the driver off without naming a replacement. */
  @Post('trip-schedules/:tripId/driver-assignments/end')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  @HttpCode(HttpStatus.OK)
  async endAssignment(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(endAssignmentSchema)) body: EndAssignmentBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverAssignment> {
    return this.execution.endAssignment(tripId, { by: actor.id, reason: body.reason });
  }

  /**
   * Takes a row off the board.
   *
   * POST rather than DELETE, and archive rather than delete, because the
   * runtime never issues `DELETE FROM` (boundary rule B13) and because a day's
   * dispatch record is the kind of thing that gets asked about months later.
   * 200 rather than 204: the archived row comes back, so a client can show what
   * it just removed.
   */
  @Post('trip-schedules/:tripId/archive')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('tripId', UuidParam) tripId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripSchedule> {
    return this.trips.archive(tripId, actor.id);
  }
}
