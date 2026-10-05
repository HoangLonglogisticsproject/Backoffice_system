import { httpClient } from './client';
import type { VehicleCostPage } from '@/types/vehicleCost';

/**
 * How many rows one read asks for — the server's ceiling.
 *
 * ponytail: one page, no paging controls. `vehicle_costs` is a ledger with no
 * per-day limit (0..N rows a lorry a day), so a range can hold more than this;
 * the screen then says "Đang hiển thị 200/N" and `totalAmount` still sums the
 * whole range. The route already takes `page` — wire it when ranges outgrow one.
 */
export const VEHICLE_COST_PAGE_LIMIT = 200;

/**
 * One lorry's costs over a business-date range (`cost.read`).
 *
 * ★ ITS OWN FILE, NOT `tripCost.ts`. That file is the money on a TRIP; this is
 * the lorry's ledger, which no trip total reads.
 */
export async function fetchVehicleCosts(
  vehicleId: string,
  range: { from: string; to: string },
): Promise<VehicleCostPage> {
  const { data } = await httpClient.get<VehicleCostPage>(
    `/trip-vehicles/${encodeURIComponent(vehicleId)}/costs`,
    { params: { ...range, limit: VEHICLE_COST_PAGE_LIMIT } },
  );
  return data;
}
