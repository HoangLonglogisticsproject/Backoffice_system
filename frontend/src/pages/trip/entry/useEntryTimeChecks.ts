import { useState } from 'react';
import type { TranslationKey } from '@/types/translate';
import type { TripEntryMode } from '@/types/trip';
import { timelineErrors } from '@/utils/tripTimeline';
import { useBusinessToday } from '@/hooks/useBusinessToday';
import { useNow } from '@/hooks/useNow';
import { instantsOf, pickupControls } from '../components/tripFormTimes';
import type { FormState } from './tripEntryModel';
import type { BookingRefusal, SaveRefusal } from './tripEntrySave';

/**
 * ★ WHETHER THE FORM'S TIMES ARE ACCEPTABLE — the server's calendar policy
 * and timeline, mirrored as they are typed (a booking: now or later, today
 * only with an hour), and a refusal met on save kept under its field. The
 * server holds every one of these anyway.
 */
export function useEntryTimeChecks({
  form,
  editing,
  mode,
  historicalEntry,
  t,
}: {
  form: FormState;
  editing: boolean;
  mode: TripEntryMode;
  historicalEntry: boolean;
  t: (key: TranslationKey) => string;
}) {
  /**
   * A refusal met on SAVE — the server's, or today's missing hour — kept with
   * the date and hour it was about, so it shows under its field until either
   * changes and nothing has to remember to clear it. Nothing typed is lost.
   */
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);

  /** The picker's bound on a NEW trip: a booking from today on, a recorded run up to today. */
  const today = useBusinessToday();
  /**
   * The clock the form checks against — to the minute, re-read as each minute
   * turns, never frozen at the moment the dialog opened. A submit still goes
   * to the server, which checks again on its own clock.
   */
  const now = useNow();
  const pickup = pickupControls(
    { booking: !editing && mode === 'operational', historicalEntry },
    form,
    { today, now },
    t,
  );

  /**
   * ★ CHECKED AS IT IS TYPED, per field. The calendar policy is the entry
   * intent's and binds only a NEW trip — an overdue one is corrected, not
   * re-booked. The timeline binds every save, once both hours are known. The
   * server holds both anyway.
   */
  const timeline = timelineErrors(
    { scheduledOn: form.scheduledOn, ...instantsOf(form) },
    editing ? null : mode,
    new Date(now),
  );
  const timelineRefused = Object.values(timeline).some((refused) => refused !== null);
  const refusalAt = (field: BookingRefusal['field']): string | null =>
    refusal?.field === field && refusal.scheduledOn === form.scheduledOn && refusal.pickupTime === form.pickupTime
      ? t(refusal.key)
      : null;
  /** What to say under one temporal field: the live check first, then a refusal met on save. */
  const fieldError = (field: 'scheduledOn' | 'pickupAt' | 'deliveryAt'): string | null => {
    const live = timeline[field];
    if (live) return t(live);
    return field === 'deliveryAt' ? null : refusalAt(field);
  };

  return { pickup, timelineRefused, fieldError, setRefusal };
}
