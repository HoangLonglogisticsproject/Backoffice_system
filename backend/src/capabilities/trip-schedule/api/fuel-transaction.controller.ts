import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { FuelTransactionService } from '../application/fuel-transaction.service';
import type { FuelTransactionView } from '../domain/fuel-transaction-view';
import {
  recordOnTripCostSchema,
  recordOnVehicleCostSchema,
  toTripCommand,
  type RecordOnTripCostBody,
  type RecordOnVehicleCostBody,
} from './fuel-transaction.dto';

/**
 * A fill's fuel transaction, read and recorded on its ONE money row (0037) —
 * a lorry's cost line, or a trip's fuel line from before the lorry ledger.
 *
 * ★ `cost.import`, NOT `cost.read`. Accounting backfills fuel evidence; the
 * SuperAdmin's ledger read stays where it was. This key opens the fill being
 * worked on — its amount, readings, station and receipt — and nothing about
 * the lorry's other costs or totals.
 */
@Controller()
export class FuelTransactionController {
  constructor(private readonly fuel: FuelTransactionService) {}

  @Get('trip-vehicles/:vehicleId/costs/:costId/fuel-transaction')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  async viewOnVehicleCost(
    @Param('vehicleId', UuidParam) vehicleId: string,
    @Param('costId', UuidParam) costId: string,
  ): Promise<FuelTransactionView> {
    return this.fuel.viewOfVehicleCost(vehicleId, costId);
  }

  @Post('trip-vehicles/:vehicleId/costs/:costId/fuel-transaction')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  async recordOnVehicleCost(
    @Param('vehicleId', UuidParam) vehicleId: string,
    @Param('costId', UuidParam) costId: string,
    @Body(new ZodValidationPipe(recordOnVehicleCostSchema)) body: RecordOnVehicleCostBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<FuelTransactionView> {
    const { evidence, ...facts } = body;
    return this.fuel.recordOnVehicleCost(vehicleId, costId, { facts, evidence }, actor.id);
  }

  @Get('trip-schedules/:tripId/costs/:costId/fuel-transaction')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  async viewOnTripCost(
    @Param('tripId', UuidParam) tripId: string,
    @Param('costId', UuidParam) costId: string,
  ): Promise<FuelTransactionView> {
    return this.fuel.viewOfTripCost(tripId, costId);
  }

  @Post('trip-schedules/:tripId/costs/:costId/fuel-transaction')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  async recordOnTripCost(
    @Param('tripId', UuidParam) tripId: string,
    @Param('costId', UuidParam) costId: string,
    @Body(new ZodValidationPipe(recordOnTripCostSchema)) body: RecordOnTripCostBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<FuelTransactionView> {
    return this.fuel.recordOnTripCost(tripId, costId, toTripCommand(body), actor.id);
  }
}
