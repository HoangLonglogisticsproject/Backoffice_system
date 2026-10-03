import { useSession } from '@/contexts/SessionProvider';
import type { TripScheduleWithRefs } from '@/types/trip';

/**
 * Editing an existing row while holding the price keys and nothing else — a
 * dispatch member. The form then sends the two prices and disables the rest.
 */
const isPriceOnly = (
  trip: TripScheduleWithRefs | null,
  mayEditTrip: boolean,
  mayEditPrices: boolean,
): boolean => trip !== null && !mayEditTrip && mayEditPrices;

/** What this caller may do on the trip form — each key read once, with the reason it is read. */
export function useEntryPermissions(trip: TripScheduleWithRefs | null) {
  // ★ A RENDER HINT THAT ALSO CHANGES THE PAYLOAD, WHICH IS UNUSUAL HERE AND
  // DELIBERATE. Everywhere else in this app `can()` only hides a control the
  // server would refuse anyway. Prices are different: the server refuses a body
  // that so much as MENTIONS them from a caller without the permission, so this
  // decides which keys are sent, not merely which fields are drawn. Getting it
  // wrong is a 403 on save rather than a silently ignored field — which is the
  // failure mode worth having.
  const { can } = useSession();
  // ★ TWO KEYS SINCE 0032. Reading draws the two figures; WRITING is what
  // decides whether they are typed into and whether the keys travel. Today
  // both are accounting's (DL-111); a holder of the first without the second
  // gets the fields drawn disabled and a payload carrying neither key — the
  // server would answer 403 to a body that so much as mentioned a price.
  const mayViewPrices = can('trip.price.read');
  const mayEditPrices = can('trip.price.write');
  // ★ PRICE-ONLY EDITING. An accounting member prices an existing trip without
  // holding `trip.write`; the server authorizes the patch per field, so this
  // form sends the two price keys and nothing else, and every other control
  // is disabled so nothing typed into it can be lost on save.
  const mayEditTrip = can('trip.write');
  const priceOnly = isPriceOnly(trip, mayEditTrip, mayEditPrices);
  // Correcting a place — locating it — is `trip.write`, the same key the
  // master-data screen asks for. A dispatcher without it still sees that a
  // place is not located; they just cannot fix it from here.
  const mayManagePlaces = can('trip.write');
  // Filing a new customer or a new place from inside the form — one key each
  // (DL-112). Without the key the control is not drawn; the server refuses
  // the POST regardless of what the client draws.
  const mayCreateCustomer = can('customer.create');
  const mayCreatePlace = can('location.create');

  return { mayViewPrices, mayEditPrices, priceOnly, mayManagePlaces, mayCreateCustomer, mayCreatePlace };
}
