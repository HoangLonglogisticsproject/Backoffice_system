import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTripLocations } from '@/hooks/trip';
import type { TripLocation, TripScheduleWithRefs } from '@/types/trip';
import { NO_REFRESH, type End, type EndFlags, type FormState } from './tripEntryModel';
import { bothLocated, locationIdAt, placeFor, reconcilePlaces, snapshotOf, type ChosenPlace } from './tripEntryPlaces';

/**
 * The customer's places on the form: the list, the form kept honest against
 * it, the place each end will run against, its readiness, and the one place
 * dialog — the rules themselves are `tripEntryPlaces`.
 */
export function useEntryPlaces(
  form: FormState,
  setForm: Dispatch<SetStateAction<FormState>>,
  trip: TripScheduleWithRefs | null,
) {
  /**
   * ★ WHICH ENDS THE OFFICE REFRESHED FROM THIS FORM. Correcting a place
   * through the dialog below changes the master row, not the trip; the trip
   * keeps its snapshot until a save names the place again. These flags are
   * what make the next save do that — see `endFields` — and what make the
   * readiness pill read the master for that end in the meantime, so the two
   * never disagree. Reset whenever the form opens on a row.
   */
  const [refreshed, setRefreshed] = useState<EndFlags>(NO_REFRESH);

  // The chosen customer's places, and the form kept honest against them —
  // see `reconcilePlaces`.
  const locations = useTripLocations(form.customerId);
  useEffect(() => {
    setForm((current) => reconcilePlaces(current, locations.data, trip));
  }, [form.customerId, form.pickupLocationId, form.deliveryLocationId, locations.data, trip, setForm]);

  /** The place one end will run against — see `placeFor`. */
  const placeAt = (end: End): ChosenPlace | null =>
    placeFor(locationIdAt(form, end), locations.data ?? [], snapshotOf(trip, end), refreshed[end]);

  /**
   * ★ READINESS IS "HAS COORDINATES", AND NOTHING ELSE. The driver's
   * confirmation at an end is refused by the server unless the trip's
   * snapshot of that end carries a point, so a trip is ready for location
   * verification exactly when BOTH ends name a located place. A hand-typed
   * address has no point and counts as not ready — which is the truth the
   * driver would otherwise discover at the gate. Whether a driver's reading
   * later PASSES is a different fact, decided by the server.
   */
  const tripLocationReady = bothLocated(placeAt('pickup'), placeAt('delivery'));

  /**
   * The place dialog, if open: which end asked for it, and — for "set up
   * location" — which existing place it corrects. One dialog for both jobs;
   * there is no second way to put coordinates on a place.
   */
  const [placeDialog, setPlaceDialog] = useState<{ end: End; editing: TripLocation | null } | null>(null);

  /**
   * After the place dialog saved. A NEW place is selected where it was asked
   * for — AFTER the list has been re-read, so the effect that drops unknown
   * places never sees the new id before the list that contains it. A place
   * CORRECTED from here is already selected; the re-read list carries its
   * coordinates, and the end is marked so the next save names the place again
   * and the server copies it afresh.
   */
  const placeSaved = async (location: TripLocation) => {
    if (!placeDialog) return;
    const { end, editing } = placeDialog;
    await locations.reload();
    if (editing) setRefreshed((flags) => ({ ...flags, [end]: true }));
    else setForm((current) => ({ ...current, [end === 'pickup' ? 'pickupLocationId' : 'deliveryLocationId']: location.id }));
  };

  return {
    refreshed,
    resetRefreshed: () => setRefreshed(NO_REFRESH),
    locations,
    snapshotAt: (end: End) => snapshotOf(trip, end),
    placeAt,
    tripLocationReady,
    placeDialog,
    setPlaceDialog,
    placeSaved,
  };
}
