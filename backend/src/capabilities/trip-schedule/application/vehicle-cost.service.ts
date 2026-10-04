import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/errors/domain.error';
import type { DateRangePageQuery } from '../../../common/pagination/date-range-page-query.dto';
import { toOffsetPage } from '../../../common/pagination/offset-page';
import type { VehicleCostCategory, VehicleCostPage } from '../domain/vehicle-fuel';
import { TripVehicleRepository } from '../persistence/trip-catalogue.repository';
import { VehicleCostRepository } from '../persistence/vehicle-cost.repository';

/**
 * A lorry's costs, read — the foundation a vehicle P&L will stand on (0034).
 *
 * By lorry, over a business-date range (bounded by the shared range DTO, as
 * the board is), optionally by heading, with the money total of the whole
 * filter. Live rows only. No revenue and no allocation here: that is a later
 * decision, not something a read should invent.
 */
@Injectable()
export class VehicleCostService {
  constructor(
    private readonly vehicles: TripVehicleRepository,
    private readonly costs: VehicleCostRepository,
  ) {}

  async page(
    vehicleId: string,
    query: DateRangePageQuery & { category?: VehicleCostCategory },
  ): Promise<VehicleCostPage> {
    // An archived lorry's costs stay readable — its money outlives its service.
    if (!(await this.vehicles.findById(vehicleId))) throw new NotFoundError('Vehicle not found.');

    const { items, total, totalAmount } = await this.costs.page(
      vehicleId,
      { from: query.from, to: query.to, category: query.category ?? null },
      query.limit,
      (query.page - 1) * query.limit,
    );
    return { ...toOffsetPage(items, total, query.page, query.limit), totalAmount };
  }
}
