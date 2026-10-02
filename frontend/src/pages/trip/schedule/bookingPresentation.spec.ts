import { describe, expect, it } from 'vitest';
import type { PermissionKey } from '@/types/auth';
import type { TripAssignmentRef, TripScheduleWithRefs } from '@/types/trip';
import { bookingActions, crewSignal, DUE_SOON_MS, urgencyOf } from './bookingPresentation';

/** Only the fields this module reads. */
const booking = (over: Partial<TripScheduleWithRefs> = {}): TripScheduleWithRefs =>
  ({ status: 'pending', assignments: [], legacyVehicleId: null, pickupAt: null, ...over }) as TripScheduleWithRefs;

const turn = (started = false): TripAssignmentRef =>
  ({ id: 'a1', vehicle: { id: 'v1', plate: '50H-49266' }, driver: { id: 'd1' }, started }) as TripAssignmentRef;

const holding =
  (...keys: PermissionKey[]) =>
  (key: PermissionKey) =>
    keys.includes(key);

const NOW = Date.parse('2026-10-02T03:00:00.000Z');
const inMs = (ms: number) => new Date(NOW + ms).toISOString();

describe('crewSignal — the crew line, read from the row', () => {
  it('nobody on it is unassigned, and a legacy planned lorry says so', () => {
    expect(crewSignal(booking())).toBe('unassigned');
    expect(crewSignal(booking({ legacyVehicleId: 'v9' }))).toBe('legacyVehicle');
  });

  it('★ any active pair is assigned — the legacy lorry no longer matters', () => {
    expect(crewSignal(booking({ assignments: [turn()], legacyVehicleId: 'v9' }))).toBe('assigned');
  });
});

describe('urgencyOf — the planned hour against the clock, from the list row alone', () => {
  it('★ no booked hour, no urgency — never invented from the date', () => {
    expect(urgencyOf(booking({ scheduledOn: '2026-10-02' }), NOW)).toBeNull();
  });

  it('due soon inside the window, nothing beyond it', () => {
    expect(urgencyOf(booking({ pickupAt: inMs(DUE_SOON_MS) }), NOW)).toBe('dueSoon');
    expect(urgencyOf(booking({ pickupAt: inMs(DUE_SOON_MS + 1) }), NOW)).toBeNull();
  });

  it('★ past the planned hour once it passes with nobody started — it does not vanish when it matters most', () => {
    expect(urgencyOf(booking({ pickupAt: inMs(-1) }), NOW)).toBe('pastPlanned');
  });

  it('★ a driver who has reported silences it, whatever the status says', () => {
    expect(urgencyOf(booking({ pickupAt: inMs(-1), assignments: [turn(true)] }), NOW)).toBeNull();
    expect(urgencyOf(booking({ pickupAt: inMs(-1), status: 'executing' }), NOW)).toBe('pastPlanned');
  });
});

describe('bookingActions — domain verbs, never a status picker', () => {
  it('offers a plain reader nothing to do', () => {
    expect(bookingActions(booking(), holding('trip.read'))).toEqual([]);
  });

  it('★ dispatch assigns an uncrewed trip and re-crews a crewed one — never both', () => {
    const dispatch = holding('dispatch.write');
    expect(bookingActions(booking(), dispatch)).toEqual(['assign']);
    expect(bookingActions(booking({ assignments: [turn()] }), dispatch)).toEqual(['reassign']);
  });

  it('★ trip.write starts a pending trip and sends an executing one back — the board move, named', () => {
    const write = holding('trip.write');
    expect(bookingActions(booking(), write)).toEqual(['start', 'edit', 'archive']);
    expect(bookingActions(booking({ status: 'executing' }), write)).toEqual(['returnToPending', 'edit', 'archive']);
  });

  it('★ never offers the way back once a driver has reported — the server refuses it (409), so it is not drawn', () => {
    const reported = booking({ status: 'executing', assignments: [turn(true)] });
    expect(bookingActions(reported, holding('trip.write'))).toEqual(['edit', 'archive']);
  });

  it('★ offers no move to a legacy `confirmed` row — it meant done; only completion fits', () => {
    expect(bookingActions(booking({ status: 'confirmed' }), holding('trip.write'))).toEqual(['edit', 'archive']);
    expect(bookingActions(booking({ status: 'confirmed' }), holding('trip.complete.review'))).toEqual(['complete']);
  });

  it('★ completion is trip.complete.review alone — trip.write and dispatch never imply it', () => {
    const everythingElse = holding('trip.write', 'dispatch.write', 'trip.price.write', 'cost.read');
    expect(bookingActions(booking(), everythingElse)).not.toContain('complete');
    expect(bookingActions(booking(), holding('trip.complete.review'))).toEqual(['complete']);
  });

  it('prices alone open the form; cost.read alone opens the costs', () => {
    expect(bookingActions(booking(), holding('trip.price.write'))).toEqual(['edit']);
    expect(bookingActions(booking(), holding('cost.read'))).toEqual(['costs']);
  });

  it('★ a finished row is offered nothing, however senior the viewer', () => {
    const all = holding('trip.write', 'dispatch.write', 'trip.complete.review', 'cost.read', 'trip.price.write');
    expect(bookingActions(booking({ status: 'finished' }), all)).toEqual([]);
  });
});
