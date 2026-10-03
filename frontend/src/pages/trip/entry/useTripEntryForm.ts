import { type FormEvent, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { updateTripSchedule } from '@/api/tripSchedule';
import type { TripEntryMode, TripScheduleWithRefs } from '@/types/trip';
import { blank, emptyForm, initialForm, tripPayload, withCustomer, type FormState } from './tripEntryModel';
import { dispatchCrew, failureMessage, persistTrip, recordHistorical, saveFailure } from './tripEntrySave';
import { useEntryCrew } from './useEntryCrew';
import { useEntryPermissions } from './useEntryPermissions';
import { useEntryPlaces } from './useEntryPlaces';
import { useEntryTimeChecks } from './useEntryTimeChecks';

/**
 * Entering or correcting one trip: the form's state and its save, with the
 * parts that have rules of their own in their own hooks — who may do what
 * (`useEntryPermissions`), when the times are acceptable
 * (`useEntryTimeChecks`), the customer's places (`useEntryPlaces`) and the
 * crew rows (`useEntryCrew`). Everything but how the form is drawn.
 *
 * ★ ONE FORM, TWO PRESENTATIONS. "Thêm chuyến" draws it as the booking
 * workspace (`OperationalBookingDialog`); "Nhập chuyến cũ" and every
 * correction draw it as `TripFormModal`. Both read THIS hook, so the payload,
 * the place rules, the price permissions, the crew and the time boundary are
 * one implementation whichever screen is typing into it.
 */

export interface TripEntryOptions {
  isOpen: boolean;
  /** Absent means "add". Present means "correct this row". */
  trip: TripScheduleWithRefs | null;
  /** Why a new trip is entered — see `TripFormModal`'s `mode`. Ignored when correcting a row. */
  mode: TripEntryMode;
  /** May the caller dispatch? Draws the crew rows on create. */
  mayDispatch: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Same construction the form always had: one `useState` per concern, a native
 * `<form onSubmit>`, HTML validation attributes, and the server's message shown
 * when it refuses. No form library — this project has none.
 */
export function useTripEntryForm({ isOpen, trip, mode, mayDispatch, onClose, onSaved }: TripEntryOptions) {
  const { t } = useLanguage();
  const permissions = useEntryPermissions(trip);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * ★ THE TRIP IS CREATED ONCE, EVEN IF SAVE IS PRESSED TWICE.
   *
   * There is no endpoint that writes a trip and its assignments together, so a
   * save that creates the trip and then has a lorry refused leaves a real trip
   * on the board with some of its crew. Remembering the id is what makes the
   * retry send only the rows that are left instead of booking a second trip —
   * the one failure this flow could cause that nobody could undo from the UI.
   */
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);

  const editing = trip !== null;
  /** Recording a past run: born finished, crew in the same request. */
  const historicalEntry = !editing && mode === 'historical';
  const times = useEntryTimeChecks({ form, editing, mode, historicalEntry, t });
  const places = useEntryPlaces(form, setForm, trip);
  const crewRows = useEntryCrew(isOpen && mayDispatch && trip === null, t);

  // Reloading the form when the dialog opens on a different row. Keyed on the
  // id rather than on the object, so an unrelated list refresh that produces a
  // new object for the same trip does not throw away what somebody is typing.
  useEffect(() => {
    if (!isOpen) return;
    setForm(initialForm(trip));
    places.resetRefreshed();
    setError(null);
    times.setRefusal(null);
    crewRows.setCrew([]);
    setCreatedTripId(null);
  }, [isOpen, trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const chooseCustomer = (id: string | null) => setForm((current) => withCustomer(current, id));

  const close = () => {
    setError(null);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await save();
  };

  const save = async () => {
    setError(null);

    // The browser already stops a submit on a refused date or instant (see
    // `TripTimeField`); this covers a submit that did not come through it.
    // A price-only save sends no instant, so nothing here can block it.
    if (!permissions.priceOnly && times.timelineRefused) return;
    // The browser's `required` stops this first; this covers a submit that did not come through it.
    if (times.pickup.hourMissing) {
      times.setRefusal({ field: 'pickupAt', key: 'pickupTimeRequiredToday', scheduledOn: form.scheduledOn, pickupTime: '' });
      return;
    }

    const checked = crewRows.checkCrew(crewRows.crew);
    crewRows.setCrew(checked);
    if (checked.some((row) => row.error !== null)) return;

    setBusy(true);
    try {
      // ★ BUILT FROM THE FORM ON EVERY SAVE, AND ON A RETRY IT IS SENT.
      // Remembering the id stops a second trip being booked; it must not also
      // mean the second press throws away what was typed in between. A
      // dispatcher who fixes a refused lorry AND corrects the date in the same
      // breath expects both to land — and the first press is exactly when a
      // wrong date gets noticed, because that is when the row appears.
      if (historicalEntry) {
        await recordHistorical(tripPayload(form, trip, permissions.mayEditPrices, places.refreshed), checked);
        onSaved();
        onClose();
        return;
      }

      let tripId: string;
      if (permissions.priceOnly && trip) {
        // Only the two keys the caller may set. Anything else in the body
        // would make the server ask for `trip.write` and refuse the whole patch.
        await updateTripSchedule(trip.id, {
          sellPrice: blank(form.sellPrice),
          purchasePrice: blank(form.purchasePrice),
        });
        tripId = trip.id;
      } else {
        tripId = await persistTrip(trip, createdTripId, {
          ...tripPayload(form, trip, permissions.mayEditPrices, places.refreshed),
          // ★ LỊCH SỬ CHUYẾN'S CORRECTION IS LEFT EXACTLY AS IT WAS: it shows
          // its frozen `finished` and re-sends it, which the server takes as
          // no move. Lịch xe sends none — see `tripPayload`.
          ...(mode === 'historical' ? { status: form.status } : {}),
        });
        // A NEW trip's id is remembered so a retry corrects it rather than
        // booking it again; on a retry this stores the same id it already holds.
        if (trip === null) setCreatedTripId(tripId);
      }

      const failed = await dispatchCrew(tripId, checked, (error_) =>
        failureMessage(error_, t('saveFailed')),
      );

      // The trip is on the board whether or not every lorry landed, so the
      // list is re-read either way; hiding it until the crew is complete would
      // be hiding a row that exists.
      onSaved();
      crewRows.setCrew(failed);
      if (failed.length > 0) {
        setError(t('crewPartlyAssigned'));
        return;
      }
      onClose();
    } catch (error_) {
      const failure = saveFailure(error_, form, t('saveFailed'));
      times.setRefusal(failure.refusal);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * ★ THE FORM EDITS NO STATUS, ON ANY TRIP. A booking opens at the server's
   * `pending` and moves by Lịch xe's named actions; `finished` is reached by
   * completion alone (BD-01) and is terminal. So the only status this form
   * ever shows is a FROZEN `finished` — on a finished trip, or one recorded
   * after it ran — and on a booking it shows none.
   *
   * Every other field of a finished trip stays editable. Whether a closed trip
   * should be read-only in full is a separate decision nobody has taken, and
   * this is not the place to take it.
   *
   * A trip being RECORDED after it ran shows the same frozen `finished`: that
   * is what it will be, and the request carries no status to choose.
   */
  const statusLocked = trip?.status === 'finished' || historicalEntry;

  return {
    trip,
    form,
    set,
    chooseCustomer,
    busy,
    error,
    editing,
    historicalEntry,
    statusLocked,
    ...permissions,
    pickup: times.pickup,
    fieldError: times.fieldError,
    locations: places.locations,
    snapshotAt: places.snapshotAt,
    placeAt: places.placeAt,
    tripLocationReady: places.tripLocationReady,
    placeDialog: places.placeDialog,
    setPlaceDialog: places.setPlaceDialog,
    placeSaved: places.placeSaved,
    crew: crewRows.crew,
    takenVehicleIds: crewRows.takenVehicleIds,
    addCrew: crewRows.addCrew,
    removeCrew: crewRows.removeCrew,
    setCrewAt: crewRows.setCrewAt,
    drivers: crewRows.drivers,
    submit,
    close,
  };
}

/** One trip being entered or corrected — what both presentations draw. */
export type TripEntry = ReturnType<typeof useTripEntryForm>;
