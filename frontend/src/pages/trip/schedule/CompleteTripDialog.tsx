import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCompleteTrip } from '@/hooks/trip';
import type { TripScheduleWithRefs } from '@/types/trip';
import { isApiError } from '@/utils/errors';
import { formatCalendarDay } from '@/utils/format/datetime';

/**
 * Confirming "Đánh dấu Đã xác nhận" — the SuperAdmin's manual completion.
 *
 * ★ A CONFIRMATION, BECAUSE THERE IS NO WAY BACK. `finished` is permanent
 * (0025's trigger) and the trip leaves Lịch xe for good, so the body says
 * exactly that — and names the trip, so the click is about a row, not about
 * "this".
 *
 * ★ THE REFUSAL STAYS IN THE DIALOG. A 409 here means something real — the
 * trip was closed meanwhile, or a driver's completion request is waiting and
 * is the completion being asked for — and the server's sentence says which.
 */
export function CompleteTripDialog({
  trip,
  onClose,
}: Readonly<{ trip: TripScheduleWithRefs | null; onClose: () => void }>) {
  const { t, language } = useLanguage();
  const complete = useCompleteTrip();

  const close = () => {
    if (complete.isPending) return;
    complete.reset();
    onClose();
  };

  const confirm = async () => {
    if (!trip) return;
    try {
      await complete.mutateAsync(trip.id);
      complete.reset();
      onClose();
    } catch {
      // Shown below, from `complete.error`.
    }
  };

  const error = complete.error;
  return (
    <Modal
      isOpen={trip !== null}
      onClose={close}
      title={t('bookingComplete')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={close} disabled={complete.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={complete.isPending}
            className="bg-green-700 text-white hover:bg-green-800"
          >
            {complete.isPending ? t('saving') : t('bookingComplete')}
          </Button>
        </>
      }
    >
      {trip && (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-gray-900">
            {formatCalendarDay(trip.scheduledOn, language)} · {trip.customer?.name ?? t('notSelected')}
          </p>
          <p className="text-gray-600">{t('completeTripBody')}</p>
          {error && (
            <p role="alert" className="text-red-600">
              {isApiError(error) && error.status > 0 ? error.message : t('saveFailed')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
