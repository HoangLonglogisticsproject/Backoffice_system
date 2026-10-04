import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { dateRangePageQuerySchema } from '../../../common/pagination/date-range-page-query.dto';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { VehicleCostService } from '../application/vehicle-cost.service';
import { VEHICLE_COST_CATEGORIES, type VehicleCostPage } from '../domain/vehicle-fuel';

/**
 * A lorry's money, read by the office (0034).
 *
 * ★ ITS OWN CONTROLLER, FOR THE REASON `TripCostController` HAS ONE: the
 * catalogue answers `trip.read`, this answers `cost.read` — and routes that
 * ask different authorization questions do not share a file, which is how a
 * route ends up behind the wrong decorator.
 *
 * The range and the page are the shared DTO's (bounded, defaulting to the
 * current business month); `category` narrows to one heading.
 */
const vehicleCostQuerySchema = dateRangePageQuerySchema.and(
  z.object({ category: z.enum(VEHICLE_COST_CATEGORIES).optional() }),
);

type VehicleCostQuery = z.infer<typeof vehicleCostQuerySchema>;

@Controller()
export class VehicleCostController {
  constructor(private readonly costs: VehicleCostService) {}

  @Get('trip-vehicles/:vehicleId/costs')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.read')
  async listCosts(
    @Param('vehicleId', UuidParam) vehicleId: string,
    @Query(new ZodValidationPipe(vehicleCostQuerySchema)) query: VehicleCostQuery,
  ): Promise<VehicleCostPage> {
    return this.costs.page(vehicleId, query);
  }
}
