import { useState } from 'react';
import { archiveTripSchedule } from '@/api/tripSchedule';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TripScheduleWithRefs } from '@/types/trip';
import { isApiError } from '@/utils/errors';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay } from '@/utils/format/datetime';

/** Every plate on the trip on one line, for a sentence that names the row. */
const platesOf = (trip: TripScheduleWithRefs): string =>
  trip.assignments
    .map((turn) => (turn.vehicle ? formatPlate(turn.vehicle.plate) : ''))
    .filter(Boolean)
    .join('; ');

/**
 * Confirming an archive.
 *
 * ★ THE BODY SAYS WHAT ARCHIVING ACTUALLY DOES. The record is kept; the row
 * leaves the schedule. A dialog that said "delete permanently" would be false,
 * and one that said "remove" would leave the reader guessing which of the two
 * it meant — on an action they cannot undo from this screen.
 */
export function ArchiveTripDialog({
  trip,
  onClose,
  onArchived,
}: Readonly<{
  trip: TripScheduleWithRefs | null;
  onClose: () => void;
  onArchived: () => void;
}>) {
  const { t, language } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!trip) return;
    setBusy(true);
    setError(null);

    try {
      await archiveTripSchedule(trip.id);
      onArchived();
      onClose();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={trip !== null}
      onClose={onClose}
      title={t('confirmArchiveTripTitle')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy}>
            {busy ? t('saving') : t('archive')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{t('confirmArchiveTripBody')}</p>
        {trip && (
          <p className="text-sm font-medium text-gray-900">
            {`${formatCalendarDay(trip.scheduledOn, language)} · ${platesOf(trip) || '—'} · ${trip.customer?.name ?? '—'}`}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
