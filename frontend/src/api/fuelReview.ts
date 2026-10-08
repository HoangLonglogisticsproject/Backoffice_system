import { httpClient } from './client';
import type { FuelReviewAction, FuelReviewDetail, FuelReviewStatus, FuelSubmission } from '@/types/fuel';
import type { OffsetPage } from '@/types/pagination';

/**
 * "Kế toán → Nhiên liệu" (`cost.import`, 0038): the drivers' fills by review
 * state, and the four decisions on one. ★ No payment is made by any call
 * here — `mark-paid` records that Accounting paid the station outside the app.
 */
export const FUEL_REVIEW_PAGE_LIMIT = 50;

export async function fetchFuelReviews(status: FuelReviewStatus, page: number): Promise<OffsetPage<FuelSubmission>> {
  const { data } = await httpClient.get<OffsetPage<FuelSubmission>>('/fuel-reviews', {
    params: { status, page, limit: FUEL_REVIEW_PAGE_LIMIT },
  });
  return data;
}

export async function fetchFuelReview(id: string): Promise<FuelReviewDetail> {
  const { data } = await httpClient.get<FuelReviewDetail>(`/fuel-reviews/${encodeURIComponent(id)}`);
  return data;
}

/** `request-info` and `reject` need a note the driver can read; the others may carry one (a transfer reference). */
export async function decideFuelReview(id: string, action: FuelReviewAction, note?: string): Promise<FuelReviewDetail> {
  const { data } = await httpClient.post<FuelReviewDetail>(
    `/fuel-reviews/${encodeURIComponent(id)}/${action}`,
    note ? { note } : {},
  );
  return data;
}
