import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useChangeDriverAssignment, useEligibleDrivers } from '@/hooks/trip/useTripAssignment';
import { isApiError } from '@/utils/errors';
import type { TripScheduleWithRefs } from '@/types/trip';

interface Props {
  /** The trip being crewed, or `null` when closed. */
  trip: TripScheduleWithRefs | null;
  onClose: () => void;
}

/**
 * Putting a driver on a trip, or swapping the one on it.
 *
 * ★ OPERATIONS DOES THIS, NEVER THE DRIVER. This dialog lives on the
 * dispatch board behind `trip.write`; the Driver Portal has no such control
 * and the server refuses a driver account the route outright.
 *
 * ★ A 409 IS THE BOARD MOVING, AND THE ANSWER IS TO LOOK AGAIN. Two
 * dispatchers assigning at once, a trip closed a moment ago, a driver disabled
 * in the meantime — the server refuses, the mutation re-reads the board on
 * settle, and the message says so. The submit button is disabled while a
 * request is in flight, so a double-click cannot send two.
 */
export function DriverAssignModal({ trip, onClose }: Readonly<Props>) {
  const { t } = useLanguage();
  const open = trip !== null;
  const drivers = useEligibleDrivers(open);
  const change = useChangeDriverAssignment();

  const [driverUserId, setDriverUserId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const current = trip?.driver ?? null;
  const replacing = current !== null;

  // Reset per trip, not per render: reopening on another row must not carry
  // the previous choice.
  useEffect(() => {
    setDriverUserId('');
    setReason('');
    setError(null);
  }, [trip?.id]);

  const options = (drivers.data ?? []).filter((driver) => driver.id !== current?.id);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trip || change.isPending) return;
    setError(null);

    try {
      await change.mutateAsync(
        replacing
          ? { kind: 'replace', tripId: trip.id, driverUserId, reason: reason.trim() }
          : { kind: 'assign', tripId: trip.id, driverUserId },
      );
      onClose();
    } catch (error_) {
      // 409: the board moved under us; the hook has already re-read it.
      if (isApiError(error_) && error_.status === 409) setError(t('assignConflict'));
      else setError(isApiError(error_) ? error_.message : t('saveFailed'));
    }
  };

  const formId = 'driver-assign-form';

  let submitLabel = replacing ? t('changeDriver') : t('assignDriver');
  if (change.isPending) submitLabel = t('saving');

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={t('assignDriverTitle')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={change.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={change.isPending || driverUserId === '' || (replacing && reason.trim() === '')}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-700">
          <span className="text-gray-500">{t('currentDriver')}: </span>
          {current ? current.displayName : t('driverUnassigned')}
        </p>

        <div className="space-y-2">
          <label htmlFor="assign-driver" className="text-sm font-medium text-gray-700">
            {t('selectDriver')}
          </label>
          <select
            id="assign-driver"
            value={driverUserId}
            onChange={(event) => setDriverUserId(event.target.value)}
            required
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">{drivers.isLoading ? t('loading') : t('selectDriver')}</option>
            {options.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.displayName}
              </option>
            ))}
          </select>
          {!drivers.isLoading && options.length === 0 ? (
            <p className="text-xs text-gray-500">{t('noEligibleDrivers')}</p>
          ) : null}
        </div>

        {replacing ? (
          <div className="space-y-2">
            <label htmlFor="assign-reason" className="text-sm font-medium text-gray-700">
              {t('assignReason')}
            </label>
            <textarea
              id="assign-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              required
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
