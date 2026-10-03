import type { TripLocation, TripScheduleWithRefs } from '@/types/trip';
import type { End, FormState } from './tripEntryModel';

/**
 * The places each end of a trip may name, and the one it will actually run
 * against — the rules that keep a booking for customer B off customer A's
 * warehouse, and that say whether the driver's location checks can work.
 * Pure.
 */

/**
 * ★ THE TRIP'S OWN COPY OF ONE END: the place it was copied from, with the
 * address, contact and coordinates the trip actually holds. This — not the
 * master row — is what the driver is measured against, until the reference is
 * changed or deliberately refreshed. The active list does not carry an
 * archived place, but the trip still names it and still holds the copy; that
 * copy is what the form shows for it, read-only, and the reference stays
 * selected. Nothing is reactivated; choosing another place is the
 * dispatcher's to do.
 */
export const snapshotOf = (trip: TripScheduleWithRefs | null, end: End): ChosenPlace | null => {
  const ref = end === 'pickup' ? trip?.pickupLocation : trip?.deliveryLocation;
  if (!trip || !ref) return null;
  return end === 'pickup'
    ? {
        ...ref,
        address: trip.pickupAddress ?? '',
        contact: trip.pickupContact,
        latitude: trip.pickupLatitude ?? null,
        longitude: trip.pickupLongitude ?? null,
      }
    : {
        ...ref,
        address: trip.deliveryAddress ?? '',
        contact: trip.deliveryContact,
        latitude: trip.deliveryLatitude ?? null,
        longitude: trip.deliveryLongitude ?? null,
      };
};

/**
 * ★ THE PLACES ARE THE CHOSEN CUSTOMER'S, AND NOBODY ELSE'S. A place still
 * selected after the customer changed is dropped the moment the new list
 * arrives without it, so a trip for customer B can never quietly carry
 * customer A's warehouse. The trip's own (possibly archived) places stay
 * known — but ONLY while the form still names the trip's own customer. The
 * server refuses the wrong pairing anyway; this keeps the form honest before
 * submit. Returns `current` itself when nothing changes, so the effect settles.
 */
export const reconcilePlaces = (
  current: FormState,
  master: TripLocation[] | null,
  trip: TripScheduleWithRefs | null,
): FormState => {
  if (current.customerId === null) {
    return current.pickupLocationId === null && current.deliveryLocationId === null
      ? current
      : { ...current, pickupLocationId: null, deliveryLocationId: null };
  }
  if (master === null) return current;

  const known = new Set(master.map((location) => location.id));
  if (current.customerId === trip?.customerId) {
    for (const end of ['pickup', 'delivery'] as const) {
      const own = snapshotOf(trip, end);
      if (own) known.add(own.id);
    }
  }
  const keep = (id: string | null) => (id !== null && known.has(id) ? id : null);
  const pickup = keep(current.pickupLocationId);
  const delivery = keep(current.deliveryLocationId);
  return pickup === current.pickupLocationId && delivery === current.deliveryLocationId
    ? current
    : { ...current, pickupLocationId: pickup, deliveryLocationId: delivery };
};

/**
 * ★ THE PLACE AN END WILL ACTUALLY RUN AGAINST. For an existing trip whose
 * reference is unchanged, that is the trip's SNAPSHOT: the master row may
 * have been located since, but the driver is measured against the copy the
 * trip holds until the office deliberately refreshes it. A refreshed or newly
 * chosen place reads from the master, because that is what the next save
 * copies. So what the readiness pill says is always what the driver will
 * meet — never a master value the trip does not yet hold.
 */
export const placeFor = (
  value: string | null,
  master: TripLocation[],
  snapshot: ChosenPlace | null,
  refreshed: boolean,
): ChosenPlace | null => {
  if (value === null) return null;
  if (snapshot?.id === value && !refreshed) return snapshot;
  return master.find((location) => location.id === value) ?? (snapshot?.id === value ? snapshot : null);
};

/** The place id the form holds for one end. */
export const locationIdAt = (form: FormState, end: End): string | null =>
  end === 'pickup' ? form.pickupLocationId : form.deliveryLocationId;

/** What the read-only block after a choice shows: an active place, or the trip's own copy of an archived one. */
export interface ChosenPlace {
  id: string;
  name: string;
  address: string;
  contact: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Both halves present — the only readiness there is. The server stores them
 * both or neither. `!= null` on purpose: `?.` yields `undefined` for no place,
 * and that must read as "not located" exactly like a `null` coordinate.
 */
export const isLocated = (place: ChosenPlace | null): boolean =>
  place?.latitude != null && place?.longitude != null;

/** Ready for location verification exactly when BOTH ends name a located place. */
export const bothLocated = (pickup: ChosenPlace | null, delivery: ChosenPlace | null): boolean =>
  isLocated(pickup) && isLocated(delivery);
