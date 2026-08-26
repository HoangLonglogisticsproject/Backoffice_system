import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  dateRangePageQuerySchema,
  type DateRangePageQuery,
} from '../../../common/pagination/date-range-page-query.dto';
import type { OffsetPage } from '../../../common/pagination/offset-page';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { TripScheduleService } from '../application/trip-schedule.service';
import { TRIP_STATUSES, type TripSchedule, type TripScheduleWithRefs } from '../domain/trip-schedule';

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

const updateStatusSchema = z.object({ status: tripStatus });

type CreateTripBody = z.infer<typeof createTripSchema>;
type UpdateTripBody = z.infer<typeof updateTripSchema>;
type UpdateStatusBody = z.infer<typeof updateStatusSchema>;

@Controller()
export class TripScheduleController {
  constructor(private readonly trips: TripScheduleService) {}

  /**
   * One page of the board.
   *
   * Returns `{ items, page, limit, total, totalPages }` — NOT the
   * `{ items, nextCursor, hasMore }` every other list returns. It is the one
   * exception in the API, it exists because dispatch needs "page 2 of 3" and a
   * count for the month, and it is only defensible while the date range stays
   * mandatory and capped. ADR-0003 has the argument in full.
   */
  @Get('trip-schedules')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async list(
    @Query(new ZodValidationPipe(dateRangePageQuerySchema)) query: DateRangePageQuery,
  ): Promise<OffsetPage<TripScheduleWithRefs>> {
    return this.trips.list(query);
  }

  @Get('trip-schedules/:tripId')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async findOne(
    @Param('tripId', UuidParam) tripId: string,
  ): Promise<TripScheduleWithRefs> {
    return this.trips.findById(tripId);
  }

  @Post('trip-schedules')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
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
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('trip.write')
  async update(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(updateTripSchema)) body: UpdateTripBody,
  ): Promise<TripSchedule> {
    return this.trips.update(tripId, body);
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
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('trip.write')
  async updateStatus(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(updateStatusSchema)) body: UpdateStatusBody,
  ): Promise<TripSchedule> {
    return this.trips.updateStatus(tripId, body.status);
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
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('trip.write')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('tripId', UuidParam) tripId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripSchedule> {
    return this.trips.archive(tripId, actor.id);
  }
}
