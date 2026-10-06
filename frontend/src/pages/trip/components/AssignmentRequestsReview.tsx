import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDecideAssignmentRequest, useTripAssignmentRequests } from '@/hooks/trip/useAssignmentRequests';
import { formatPlate } from '@/utils/format';
import { formatTimeOnDay } from '@/utils/format/datetime';
import type { DispatchAssignmentRequest } from '@/types/openBooking';
import type { TranslationKey } from '@/types/translate';
import type { TripVehicle } from '@/types/trip';

interface Props {
  tripId: string;
  /** The lorries an approval may use — active, and not already on this trip. */
  vehicles: TripVehicle[];
  /** Phase 1: an ask is approved only while nobody is on the trip. */
  crewed: boolean;
}

/**
 * "Tài xế xin nhận" — drivers' asks for this booking, decided by Dispatch (0035).
 *
 * ★ APPROVING IS ASSIGNING, SO IT NEEDS THE LORRY. "Duyệt" opens a choice of
 * lorry; the server then crews the asking driver with it through the same path
 * a direct assignment takes, and every other ask on the booking is closed.
 * Rejecting may say why. Nothing here is shown unless somebody asked.
 */
export function AssignmentRequestsReview({ tripId, vehicles, crewed }: Readonly<Props>) {
  const { t } = useLanguage();
  const requests = useTripAssignmentRequests(tripId);
  const items = requests.data ?? [];
  if (items.length === 0) return null;

  const pending = items.filter((request) => request.state === 'pending');
  const decided = items.filter((request) => request.state !== 'pending');

  return (
    <section aria-labelledby="dispatch-requests-heading" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <h3 id="dispatch-requests-heading" className="text-sm font-semibold text-gray-900">
        {t('requestReviewTitle')} ({pending.length})
      </h3>
      {pending.length === 0 ? <p className="text-sm text-gray-500">{t('requestReviewNonePending')}</p> : null}
      {crewed && pending.length > 0 ? <p className="text-xs text-amber-800">{t('requestReviewCrewed')}</p> : null}
      {pending.length > 0 ? (
        <ul className="space-y-2">
          {pending.map((request) => (
            <PendingRequest key={request.id} tripId={tripId} request={request} vehicles={vehicles} disabled={crewed} />
          ))}
        </ul>
      ) : null}
      {decided.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">
            {t('requestReviewHistory')} ({decided.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {decided.map((request) => (
              <DecidedRequest key={request.id} request={request} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function PendingRequest({
  tripId,
  request,
  vehicles,
  disabled,
}: Readonly<{ tripId: string; request: DispatchAssignmentRequest; vehicles: TripVehicle[]; disabled: boolean }>) {
  const { t, language } = useLanguage();
  const decide = useDecideAssignmentRequest();
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [vehicleId, setVehicleId] = useState('');
  const [reason, setReason] = useState('');
  const fieldId = `request-${request.id}`;

  const approve = () => decide.mutate({ kind: 'approve', tripId, requestId: request.id, vehicleId });
  const reject = () => decide.mutate({ kind: 'reject', tripId, requestId: request.id, reason: reason.trim() || null });

  return (
    <li className="space-y-2 rounded-md border border-gray-200 bg-white p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm">
          <span className="font-medium text-gray-900">{request.driver.displayName}</span>{' '}
          <span className="text-gray-500">
            · {t('requestAskedAt')} {formatTimeOnDay(request.requestedAt, language)}
          </span>
        </p>
        {mode === 'idle' ? (
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-9 gap-1 px-3" disabled={disabled} onClick={() => setMode('approve')}>
              <Check className="size-4" aria-hidden />
              {t('requestApprove')}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1 px-3" onClick={() => setMode('reject')}>
              <X className="size-4" aria-hidden />
              {t('requestReject')}
            </Button>
          </div>
        ) : null}
      </div>

      {mode === 'approve' ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <label htmlFor={`${fieldId}-vehicle`} className="text-xs font-medium text-gray-700">
              {t('fieldVehicle')}
            </label>
            <select
              id={`${fieldId}-vehicle`}
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">{t('dispatchSelectVehicle')}</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {formatPlate(vehicle.plate)}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" size="sm" className="h-9" disabled={vehicleId === '' || decide.isPending} onClick={approve}>
            {decide.isPending ? t('saving') : t('requestApproveConfirm')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-9" disabled={decide.isPending} onClick={() => setMode('idle')}>
            {t('cancel')}
          </Button>
        </div>
      ) : null}

      {mode === 'reject' ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <label htmlFor={`${fieldId}-reason`} className="text-xs font-medium text-gray-700">
              {t('requestRejectReason')}
            </label>
            <Input id={`${fieldId}-reason`} value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} />
          </div>
          <Button type="button" size="sm" variant="destructive" className="h-9" disabled={decide.isPending} onClick={reject}>
            {decide.isPending ? t('saving') : t('requestRejectConfirm')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-9" disabled={decide.isPending} onClick={() => setMode('idle')}>
            {t('cancel')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** How a request reads in the history. A superseded one says why: taken, or closed. */
const labelOf = (request: DispatchAssignmentRequest): TranslationKey => {
  switch (request.state) {
    case 'pending':
      return 'requestStatePending';
    case 'approved':
      return 'requestReviewApproved';
    case 'rejected':
      return 'requestStateRejected';
    case 'withdrawn':
      return 'requestStateWithdrawn';
    case 'superseded':
      return request.resolutionReason === 'trip_assigned' ? 'requestStateTakenByOther' : 'requestStateClosed';
  }
};

function DecidedRequest({ request }: Readonly<{ request: DispatchAssignmentRequest }>) {
  const { t, language } = useLanguage();
  const label = labelOf(request);
  return (
    <li className="flex flex-wrap items-center gap-2 text-gray-600">
      <span className="font-medium text-gray-800">{request.driver.displayName}</span>
      <StatusPill tone={request.state === 'approved' ? 'green' : 'gray'}>{t(label)}</StatusPill>
      {request.resolvedAt ? <span className="text-xs">{formatTimeOnDay(request.resolvedAt, language)}</span> : null}
      {request.state === 'rejected' && request.resolutionReason ? (
        <span className="text-xs">— {request.resolutionReason}</span>
      ) : null}
    </li>
  );
}
