import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { decideFuelReview, fetchFuelReview, fetchFuelReviews } from '@/api/fuelReview';
import { useSession } from '@/contexts/SessionProvider';
import type { FuelReviewAction, FuelReviewStatus } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';
import { notifyApiError, notifySuccess } from '@/utils/toast';
import { tripKeys } from './keys';

const DONE: Record<FuelReviewAction, TranslationKey> = {
  'request-info': 'toastFuelInfoRequested',
  approve: 'toastFuelApproved',
  reject: 'toastFuelRejected',
  'mark-paid': 'toastFuelPaid',
};

/** "Kế toán → Nhiên liệu": the drivers' fills in one review state, a page at a time (`cost.import`). */
export function useFuelReviews(status: FuelReviewStatus, page: number) {
  const { can } = useSession();
  return useQuery({
    queryKey: tripKeys.fuelReviews(status, page),
    queryFn: () => fetchFuelReviews(status, page),
    enabled: can('cost.import'),
  });
}

export function useFuelReview(id: string | null) {
  return useQuery({ queryKey: tripKeys.fuelReview(id ?? ''), queryFn: () => fetchFuelReview(id as string), enabled: id !== null });
}

/** One decision on one fill; every list and the fill itself are read again after it. */
export function useDecideFuelReview(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, note }: { action: FuelReviewAction; note?: string }) => decideFuelReview(id, action, note),
    onSuccess: (_detail, { action }) => {
      notifySuccess(DONE[action]);
      // A refusal withdraws the fill's cost: "Chi phí xe" and the day's board count it no more.
      const withdrawn = action === 'reject' ? [tripKeys.vehicleLedgers(), tripKeys.fleets()] : [];
      return Promise.all([tripKeys.fuel(), ...withdrawn].map((queryKey) => client.invalidateQueries({ queryKey })));
    },
    onError: (error) => notifyApiError(error, 'fuelReviewFailed'),
  });
}
