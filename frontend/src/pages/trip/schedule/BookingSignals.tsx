import { StatusPill } from '@/components/common/StatusPill';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePendingRequestCount } from '@/hooks/trip/useAssignmentRequests';
import type { TripScheduleWithRefs } from '@/types/trip';
import { CREW_LABELS, URGENCY_LABELS, crewSignal, type Urgency } from './bookingPresentation';

/**
 * The two readings a booking wears beside its status badge — who is on it, and
 * how its planned hour stands. Pills like every other state in the Backoffice,
 * always with their words: the colour is never the only signal.
 *
 * Amber for "nobody yet" is the queue's colour — the "chờ phân công" tab
 * counts in amber too.
 */
export function CrewPill({ trip }: Readonly<{ trip: TripScheduleWithRefs }>) {
  const { t } = useLanguage();
  const signal = crewSignal(trip);
  return <StatusPill tone={signal === 'assigned' ? 'blue' : 'amber'}>{t(CREW_LABELS[signal])}</StatusPill>;
}

/**
 * "N tài xế xin nhận" — drivers asking for this booking (0035). Dispatch only,
 * and only when somebody is asking; the count comes from one read for the
 * whole board.
 */
export function RequestsPill({ tripId }: Readonly<{ tripId: string }>) {
  const { t } = useLanguage();
  const count = usePendingRequestCount(tripId);
  if (count === 0) return null;
  return (
    <StatusPill tone="amber">
      {count} {t('requestsPill')}
    </StatusPill>
  );
}

export function UrgencyPill({ urgency }: Readonly<{ urgency: Urgency }>) {
  const { t } = useLanguage();
  if (urgency === null) return null;
  return <StatusPill tone={urgency === 'pastPlanned' ? 'red' : 'amber'}>{t(URGENCY_LABELS[urgency])}</StatusPill>;
}
