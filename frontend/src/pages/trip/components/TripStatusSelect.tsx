import { useLanguage } from '@/contexts/LanguageContext';
import { useUpdateTripStatus } from '@/hooks/trip';
import { cn } from '@/utils/cn';
import { DISPATCH_SELECTABLE_STATUSES, type TripStatus } from '@/types/trip';
import { TripStatusBadge } from './TripStatusBadge';
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
 *
 * ★ A FINISHED TRIP IS A BADGE, FOR EVERYBODY. `done` is terminal: the server
 * refuses every move away from it and a trigger in 0017 makes that permanent.
 * Rendering the dropdown on such a row would offer a control whose only
 * possible outcome is a 409 — the server still decides, this just stops asking
 * a settled question.
 *
 * ★ AND `done` IS NOT AN OPTION ON ANY ROW. A trip is finished by approving its
 * completion request, never from the board, so the option list is
 * `DISPATCH_SELECTABLE_STATUSES` rather than every status a trip may hold.
 */
export function TripStatusSelect({
  tripId,
  status,
}: Readonly<{ tripId: string; status: TripStatus }>) {
  const { t } = useLanguage();
  const mutation = useUpdateTripStatus();

  const style = TRIP_STATUS_STYLES[status];

  // Read-only, and not merely disabled: a greyed-out dropdown still says "this
  // is yours to change, later". It is not, and it never will be.
  if (status === 'done') return <TripStatusBadge status={status} />;

  // ★ NO ERROR STATE OF ITS OWN. A refusal is announced by `useUpdateTripStatus`
  // as a toast, in the server's own words, at the same moment it rolls the badge
  // back. This control lives in a table cell twelve rem wide — a sentence about
  // an archived trip did not fit here and pushed the row's height around; the
  // toast has the room and outlives a re-sort of the board.
  const change = (next: TripStatus) => {
    if (next === status) return;
    mutation.mutate({ tripId, status: next });
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
        {DISPATCH_SELECTABLE_STATUSES.map((option) => (
          <option key={option} value={option} className="bg-white text-gray-900">
            {t(TRIP_STATUS_STYLES[option].label)}
          </option>
        ))}
      </select>
    </div>
  );
}
