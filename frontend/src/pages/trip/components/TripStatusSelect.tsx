import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUpdateTripStatus } from '@/hooks/trip';
import { isApiError } from '@/utils/errors';
import { cn } from '@/utils/cn';
import { TRIP_STATUSES, type TripStatus } from '@/types/trip';
import { TRIP_STATUS_STYLES } from './tripStatus';

/**
 * The status badge, as something a dispatcher can operate.
 *
 * ★ A NATIVE `<select>` WEARING THE BADGE, and the two halves of that are both
 * deliberate. Native, because this is the control every phone in the yard
 * already knows how to open, and because the repo has no menu component to
 * borrow — the trip form's status field is a native select for the same reason.
 * Wearing the badge, because dispatch reads this column by COLOUR: turning it
 * into a plain grey dropdown would take away the one thing that makes the board
 * scannable, in exchange for looking more like a form.
 *
 * ★ ONE CLICK, NO CONFIRMATION. Changing a status is not archiving: it is
 * reversible from this very control, it is done many times a day, and a dialog
 * over it would be a dialog people learn to dismiss without reading. The
 * dangerous action on this row — archive — keeps its confirmation precisely so
 * that the difference means something.
 *
 * The change shows immediately and the request follows; see
 * `useUpdateTripStatus`. What arrives here is only the failure case.
 */
export function TripStatusSelect({
  tripId,
  status,
}: Readonly<{ tripId: string; status: TripStatus }>) {
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdateTripStatus();

  const style = TRIP_STATUS_STYLES[status];

  const change = (next: TripStatus) => {
    if (next === status) return;
    setError(null);

    mutation.mutate(
      { tripId, status: next },
      {
        // The server knows about archived trips and about states this client
        // has not heard of; its message is the honest one. The optimistic value
        // has already been rolled back by the time this runs.
        onError: (error_) =>
          setError(isApiError(error_) ? error_.message : t('statusChangeFailed')),
      },
    );
  };

  return (
    <div className="space-y-1">
      <select
        aria-label={t('changeStatus')}
        value={status}
        disabled={mutation.isPending}
        onChange={(event) => change(event.target.value as TripStatus)}
        className={cn(
          'cursor-pointer appearance-none rounded-full py-1 pr-6 pl-2 text-xs font-medium ring-1 ring-inset',
          'bg-[length:0.7rem] bg-[right_0.4rem_center] bg-no-repeat',
          'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          'disabled:cursor-wait disabled:opacity-60',
          // An unknown sixth status from the server still renders, in grey, with
          // its raw value as the label — same rule as the read-only badge.
          style?.className ?? 'bg-gray-50 text-gray-600 ring-gray-500/10',
        )}
        style={{
          // The caret, inline so it inherits `currentColor` and stays legible on
          // all five backgrounds. An <img> here would be a fixed colour.
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='currentColor' stroke-width='1.5'><path d='M1 1l4 4 4-4'/></svg>\")",
        }}
      >
        {!style && <option value={status}>{status}</option>}
        {TRIP_STATUSES.map((option) => (
          <option key={option} value={option} className="bg-white text-gray-900">
            {t(TRIP_STATUS_STYLES[option].label)}
          </option>
        ))}
      </select>

      {error && (
        <p role="alert" className="max-w-[12rem] text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
