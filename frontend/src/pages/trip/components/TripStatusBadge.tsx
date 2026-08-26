import { useLanguage } from '@/contexts/LanguageContext';
import type { TripStatus } from '@/types/trip';
import { TRIP_STATUS_STYLES } from './tripStatus';

/**
 * The state of a trip, as a badge — for a reader who may not change it.
 *
 * The colours and labels are the workbook's legend; see `tripStatus.ts`. When
 * the viewer HOLDS `trip.write`, `TripStatusSelect` renders the same badge as
 * something they can operate instead.
 */
export function TripStatusBadge({ status }: Readonly<{ status: TripStatus }>) {
  const { t } = useLanguage();
  const style = TRIP_STATUS_STYLES[status];

  // A status the client does not know is a server that shipped a sixth value.
  // Showing the raw string beats showing nothing: it is visibly wrong, and it
  // says what to go and look for.
  if (!style) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10 ring-inset">
        {status}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${style.className}`}
    >
      {t(style.label)}
    </span>
  );
}
