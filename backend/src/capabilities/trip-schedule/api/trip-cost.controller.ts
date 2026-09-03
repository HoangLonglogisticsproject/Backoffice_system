import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  PermissionGuard,
  RequirePermission,
} from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { TripCostService } from '../application/trip-cost.service';
import {
  isRecordableAmount,
  TRIP_COST_CATEGORIES,
  type OutsourceHire,
  type TripCost,
  type TripCostTotals,
} from '../domain/trip-cost';

/**
 * The money on a trip.
 *
 * ★ ITS OWN CONTROLLER, ITS OWN PERMISSION, AND THAT IS THE WHOLE POINT. The
 * requirement is that price visibility is restricted while the board itself is
 * read by everybody — `trip.read` is `'any'`. That is only achievable if the
 * amounts are never part of a trip response: a caller without `cost.read`
 * must never RECEIVE the figures, rather than receive them and be trusted to
 * hide them. So cost hangs off the trip's route but is served, and guarded,
 * separately.
 *
 *   reading            cost.read
 *   recording          cost.create
 *   withdrawing        cost.void
 *
 * ⚠ THERE IS NO EDIT ROUTE, AND THERE WILL NOT BE ONE. A financial record is
 * immutable: a wrong figure is voided, with a reason, and replaced. Neither the
 * service nor the repository offers a way to change an amount, a category or a
 * trip, so this absence is the rule rather than an oversight.
 */

/**
 * ★ AN AMOUNT IS A STRING ON THE WIRE, AND MUST STAY ONE.
 *
 * `z.number()` here would parse the body through JavaScript's float64 — the
 * exact rounding `NUMERIC(14,2)` was chosen to prevent — and `1000000.01` would
 * be stored as something a little else. JSON has no decimal type, so the only
 * lossless representation is text, and it is validated as text: the shape
 * `NUMERIC(14,2)` accepts, and at least one non-zero digit.
 */
const amount = z
  .string()
  .trim()
  .refine(isRecordableAmount, 'Expected a positive amount, e.g. "1500000.00".');

const note = z.string().trim().max(2000).nullable().optional();

const createCostSchema = z.object({
  category: z.enum(TRIP_COST_CATEGORIES),
  amount,
  note,
});

const createHireSchema = z.object({
  carrierName: z.string().trim().min(1).max(200),
  agreedAmount: amount,
  /**
   * Whether the agreed figure already contains VAT. A record, never a
   * calculation — nothing here computes or reclaims tax.
   */
  amountIncludesVat: z.boolean().optional(),
  documentRef: z.string().trim().max(200).nullable().optional(),
  note,
});

/**
 * Voiding MAY say why, and usually does not: withdrawing a record is a plain
 * confirmation in the interface, with no field to type into. A caller that does
 * send a reason still has it stored and shown beside the row; a blank string is
 * not a reason, and the service normalises it away.
 */
const voidSchema = z.object({ reason: z.string().trim().max(500).optional() });

/**
 * `?includeVoided=true`.
 *
 * An enum rather than a boolean, and NOT coerced — `z.coerce.boolean()` is a
 * trap here, because `Boolean("false")` is `true` and `?includeVoided=false`
 * would turn withdrawn records ON. The same spelling `includeArchived` uses on
 * the catalogue routes.
 */
const listQuerySchema = z.object({ includeVoided: z.enum(['true', 'false']).optional() });

type CreateCostBody = z.infer<typeof createCostSchema>;
type CreateHireBody = z.infer<typeof createHireSchema>;
type VoidBody = z.infer<typeof voidSchema>;
type ListQuery = z.infer<typeof listQuerySchema>;

const wantsVoided = (query: ListQuery): boolean => query.includeVoided === 'true';

@Controller()
export class TripCostController {
  constructor(private readonly money: TripCostService) {}

  // ---------------------------------------------------------------- costs ----

  @Get('trip-schedules/:tripId/costs')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.read')
  async listCosts(
    @Param('tripId', UuidParam) tripId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<{ items: TripCost[]; total: string }> {
    return this.money.listCosts(tripId, wantsVoided(query));
  }

  @Post('trip-schedules/:tripId/costs')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.create')
  async createCost(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(createCostSchema)) body: CreateCostBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripCost> {
    return this.money.createCost({ ...body, tripId, createdBy: actor.id });
  }

  /**
   * Withdraws a cost line.
   *
   * POST and "void", not DELETE: the row survives with who withdrew it and why,
   * because a line counted in last month's total has to stay explicable. 200
   * rather than 204 so the caller gets the withdrawn record back.
   */
  @Post('trip-schedules/:tripId/costs/:costId/void')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.void')
  @HttpCode(HttpStatus.OK)
  async voidCost(
    @Param('tripId', UuidParam) tripId: string,
    @Param('costId', UuidParam) costId: string,
    @Body(new ZodValidationPipe(voidSchema)) body: VoidBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripCost> {
    return this.money.voidCost(tripId, costId, { by: actor.id, reason: body.reason });
  }

  // ------------------------------------------------------- outsource hires ----

  @Get('trip-schedules/:tripId/outsource-hires')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.read')
  async listHires(
    @Param('tripId', UuidParam) tripId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<{ items: OutsourceHire[]; total: string }> {
    return this.money.listHires(tripId, wantsVoided(query));
  }

  @Post('trip-schedules/:tripId/outsource-hires')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.create')
  async createHire(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(createHireSchema)) body: CreateHireBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<OutsourceHire> {
    return this.money.createHire({ ...body, tripId, createdBy: actor.id });
  }

  @Post('trip-schedules/:tripId/outsource-hires/:hireId/void')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.void')
  @HttpCode(HttpStatus.OK)
  async voidHire(
    @Param('tripId', UuidParam) tripId: string,
    @Param('hireId', UuidParam) hireId: string,
    @Body(new ZodValidationPipe(voidSchema)) body: VoidBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<OutsourceHire> {
    return this.money.voidHire(tripId, hireId, { by: actor.id, reason: body.reason });
  }

  // -------------------------------------------------------------- summary ----

  /**
   * What a trip has cost, as three figures from one snapshot.
   *
   * ★ THE COMBINED TOTAL EXISTS BECAUSE A CLIENT MUST NOT ADD THE OTHER TWO.
   * They are decimal strings; `+` on them in JavaScript either concatenates or
   * goes through a float. PostgreSQL adds them, in the same statement that
   * produced the parts, so the three can never disagree.
   */
  @Get('trip-schedules/:tripId/cost-summary')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.read')
  async summary(@Param('tripId', UuidParam) tripId: string): Promise<TripCostTotals> {
    return this.money.summary(tripId);
  }
}
