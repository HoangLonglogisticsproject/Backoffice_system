import { httpClient } from './client';
import type { FleetBoard } from '@/types/fleet';

/**
 * "Điều hành xe" for one business day (`trip.read`). The amounts in it are the
 * server's to include: `null` for a reader without `cost.read`.
 */
export async function fetchFleetBoard(day: string): Promise<FleetBoard> {
  const { data } = await httpClient.get<FleetBoard>('/fleet-operations', { params: { date: day } });
  return data;
}
