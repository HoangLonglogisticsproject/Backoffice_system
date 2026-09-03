import { describe, expect, it } from 'vitest';
import {
  allowedCategories,
  canDeclareExpense,
  canSubmitCompletion,
  completionStage,
  executionSteps,
  canonicalEventOf,
  isEditable,
  isOverdue,
  lateByMinutes,
  liveExpenses,
  nextEvent,
  suggestedDeclaration,
  vehicleOwnershipOf,
  workflowStages,
  currentStage,
} from './driverExecution';
import { TRIP_COST_CATEGORIES } from '@/types/tripCost';
import type { TripCost } from '@/types/tripCost';
import type {
  CompletionRequest,
  DriverTripDetail,
  ExecutionEvent,
  ExecutionEventType,
} from '@/types/driver';

/**
 * The lifecycle, without a browser.
 *
 * ★ THIS IS WHERE THE DRIVER'S RULES ARE TESTED, and the components are then
 * only wiring. Every case below is a rule the SERVER also enforces — which event
 * comes next, when a figure may be corrected, when a completion may be sent — so
 * these double as a written statement of what the client believes the API will
 * accept. When one of them stops matching the server, the drift is visible here
 * rather than as a 409 a driver sees at a fuel station.
 */
const NOW = new Date('2026-08-30T12:00:00Z');
const EARLIER = '2026-08-30T02:00:00Z';
const LATER = '2026-08-30T20:00:00Z';

const event = (type: ExecutionEventType, over: Partial<ExecutionEvent> = {}): ExecutionEvent => ({
  id: `e-${type}`,
  tripId: 't1',
  driverAssignmentId: 'a1',
  type,
  vehicleId: 'v1',
  vehicleOwnership: 'company',
  scheduledAt: EARLIER,
  actualAt: EARLIER,
  recordedAt: EARLIER,
  deviceReportedAt: null,
  location: null,
  geofencePassed: null,
  distanceM: null,
  recordedBy: 'd1',
  recordedByUser: { id: 'd1', displayName: 'Tài Xế A' },
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  ...over,
});

const cost = (over: Partial<TripCost> = {}): TripCost => ({
  id: 'c1',
  tripId: 't1',
  category: 'fuel',
  amount: '1500000.00',
  note: null,
  state: 'editable',
  source: 'driver_portal',
  driverAssignmentId: 'a1',
  vehicleId: 'v1',
  vehicleOwnership: 'company',
  lockedAt: null,
  lockedBy: null,
  createdBy: 'd1',
  createdAt: EARLIER,
  createdByUser: { id: 'd1', displayName: 'Tài Xế A' },
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  ...over,
});

const request = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  id: 'r1',
  tripId: 't1',
  driverAssignmentId: 'a1',
  attemptNo: 1,
  expenseDeclaration: 'expenses',
  state: 'pending',
  submittedBy: 'd1',
  submittedByUser: { id: 'd1', displayName: 'Tài Xế A' },
  submittedAt: EARLIER,
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  ...over,
});

const trip = (over: Partial<DriverTripDetail> = {}): DriverTripDetail => ({
  tripId: 't1',
  scheduledOn: '2026-08-30',
  vehicle: { id: 'v1', plate: '51D-65233' },
  pickupLocation: null,
  deliveryLocation: null,
  customer: { id: 'c1', name: 'VIỄN ĐẠT' },
  pickupAddress: 'BÃI XE MIỀN NAM',
  pickupContact: null,
  deliveryAddress: 'TCS',
  deliveryContact: null,
  cargoInfo: '17CTN',
  scheduledPickupAt: LATER,
  scheduledDeliveryAt: LATER,
  driverInstructions: null,
  assignment: { id: 'a1', assignedAt: EARLIER },
  events: [],
  expenses: [],
  accountability: 'NOT_DECLARED',
  completion: null,
  ...over,
});

describe('which event comes next', () => {
  it('starts at the arrival', () => {
    expect(nextEvent([])).toBe('ARRIVED_PICKUP');
  });

  it('walks the four in order', () => {
    const seen: (ExecutionEventType | null)[] = [];
    const reported: ExecutionEvent[] = [];

    for (let step = 0; step < 5; step += 1) {
      const next = nextEvent(reported);
      seen.push(next);
      if (next) reported.push(event(next));
    }

    expect(seen).toEqual([
      'ARRIVED_PICKUP',
      'PICKUP_CONFIRMED',
      'ARRIVED_DELIVERY',
      'DELIVERY_CONFIRMED',
      null,
    ]);
  });

  it('★ ignores a withdrawn event, so the step becomes due again', () => {
    const withdrawn = [event('ARRIVED_PICKUP', { voidedAt: EARLIER, voidReason: 'nhầm chuyến' })];

    expect(nextEvent(withdrawn)).toBe('ARRIVED_PICKUP');
  });

  it('is not confused by events arriving out of order', () => {
    // The server would refuse this, but a cached response could still hold it.
    expect(nextEvent([event('PICKUP_CONFIRMED')])).toBe('ARRIVED_PICKUP');
  });
});

describe('★ the canonical reading — DL-86', () => {
  it('takes the EARLIEST of two ARRIVED reports', () => {
    // Arriving is a moment. A later duplicate must not make the trip look as
    // though it got there later than it did.
    const events = [
      event('ARRIVED_PICKUP', { id: 'late', actualAt: '2026-08-30T02:45:00Z' }),
      event('ARRIVED_PICKUP', { id: 'early', actualAt: '2026-08-30T02:20:00Z' }),
    ];

    expect(canonicalEventOf(events, 'ARRIVED_PICKUP')?.id).toBe('early');
  });

  it('★ takes the LATEST of two CONFIRMED reports', () => {
    // Finishing is a state. A driver who confirms, loads more and confirms
    // again finished at the second one.
    const events = [
      event('PICKUP_CONFIRMED', { id: 'first', actualAt: '2026-08-30T02:20:00Z' }),
      event('PICKUP_CONFIRMED', { id: 'second', actualAt: '2026-08-30T02:45:00Z' }),
    ];

    expect(canonicalEventOf(events, 'PICKUP_CONFIRMED')?.id).toBe('second');
  });

  it('applies the same split to the delivery half', () => {
    const arrivals = [
      event('ARRIVED_DELIVERY', { id: 'late', actualAt: '2026-08-30T10:00:00Z' }),
      event('ARRIVED_DELIVERY', { id: 'early', actualAt: '2026-08-30T09:00:00Z' }),
    ];
    const confirms = [
      event('DELIVERY_CONFIRMED', { id: 'first', actualAt: '2026-08-30T09:30:00Z' }),
      event('DELIVERY_CONFIRMED', { id: 'second', actualAt: '2026-08-30T10:30:00Z' }),
    ];

    expect(canonicalEventOf(arrivals, 'ARRIVED_DELIVERY')?.id).toBe('early');
    expect(canonicalEventOf(confirms, 'DELIVERY_CONFIRMED')?.id).toBe('second');
  });

  it('skips withdrawn ones when choosing', () => {
    const events = [
      event('ARRIVED_PICKUP', { id: 'void', actualAt: '2026-08-30T01:00:00Z', voidedAt: EARLIER }),
      event('ARRIVED_PICKUP', { id: 'live', actualAt: '2026-08-30T02:20:00Z' }),
    ];

    expect(canonicalEventOf(events, 'ARRIVED_PICKUP')?.id).toBe('live');
  });

  it('★ breaks a tie on recordedAt, then on id — deterministically', () => {
    // Two taps can land in the same millisecond; without a full ordering the
    // same data could report two different figures on two renders.
    const sameInstant = [
      event('ARRIVED_PICKUP', { id: 'b', actualAt: EARLIER, recordedAt: '2026-08-30T02:00:02Z' }),
      event('ARRIVED_PICKUP', { id: 'a', actualAt: EARLIER, recordedAt: '2026-08-30T02:00:01Z' }),
    ];

    expect(canonicalEventOf(sameInstant, 'ARRIVED_PICKUP')?.id).toBe('a');

    const sameStamp = [
      event('ARRIVED_PICKUP', { id: 'zz', actualAt: EARLIER, recordedAt: EARLIER }),
      event('ARRIVED_PICKUP', { id: 'aa', actualAt: EARLIER, recordedAt: EARLIER }),
    ];

    expect(canonicalEventOf(sameStamp, 'ARRIVED_PICKUP')?.id).toBe('aa');
  });

  it('is stable however the list is ordered', () => {
    const events = [
      event('PICKUP_CONFIRMED', { id: 'first', actualAt: '2026-08-30T02:20:00Z' }),
      event('PICKUP_CONFIRMED', { id: 'second', actualAt: '2026-08-30T02:45:00Z' }),
    ];

    expect(canonicalEventOf([...events].reverse(), 'PICKUP_CONFIRMED')?.id).toBe('second');
  });

  /**
   * ★ THE CASE THE FOLD MUST NOT BE HANDED.
   *
   * Reading nothing answers `null`. That was true before the seed was made
   * explicit and it is true now — the point of pinning it is that it used to
   * depend on a length check standing in front of a `reduce()` that would have
   * thrown on an empty list, and nothing tested the guard itself.
   */
  it('answers null when the milestone has no reading at all', () => {
    expect(canonicalEventOf([], 'ARRIVED_PICKUP')).toBeNull();
    expect(
      canonicalEventOf([event('PICKUP_CONFIRMED', { id: 'other' })], 'ARRIVED_PICKUP'),
    ).toBeNull();
  });

  it('answers null when every reading of it was withdrawn', () => {
    const allVoided = [
      event('ARRIVED_PICKUP', { id: 'v1', voidedAt: EARLIER }),
      event('ARRIVED_PICKUP', { id: 'v2', voidedAt: EARLIER }),
    ];

    expect(canonicalEventOf(allVoided, 'ARRIVED_PICKUP')).toBeNull();
  });

  it('returns the only reading when there is exactly one, without comparing it to itself', () => {
    // One live event means the fold has a seed and nothing to fold — the branch
    // that used to be `reduce`'s implicit first element.
    const one = [event('ARRIVED_PICKUP', { id: 'only', actualAt: EARLIER })];

    expect(canonicalEventOf(one, 'ARRIVED_PICKUP')?.id).toBe('only');
  });
});

describe('the four steps', () => {
  it('measures pickup steps against the pickup time and delivery against delivery', () => {
    const steps = executionSteps(
      trip({ scheduledPickupAt: '2026-08-30T02:00:00Z', scheduledDeliveryAt: '2026-08-30T09:00:00Z' }),
    );

    expect(steps.map((s) => s.scheduledAt)).toEqual([
      '2026-08-30T02:00:00Z',
      '2026-08-30T02:00:00Z',
      '2026-08-30T09:00:00Z',
      '2026-08-30T09:00:00Z',
    ]);
  });

  it('marks exactly one step as current', () => {
    const steps = executionSteps(trip({ events: [event('ARRIVED_PICKUP')] }));

    expect(steps.map((s) => s.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
  });

  it('★ flags a step the driver owes whose planned time has passed', () => {
    const steps = executionSteps(trip({ scheduledPickupAt: EARLIER }));

    expect(isOverdue(steps[0]!, NOW)).toBe(true);
  });

  it('never flags a step that was already reported', () => {
    const steps = executionSteps(
      trip({ scheduledPickupAt: EARLIER, events: [event('ARRIVED_PICKUP')] }),
    );

    expect(isOverdue(steps[0]!, NOW)).toBe(false);
  });

  it('★ never flags a step with no planned time — nothing to be late against', () => {
    const steps = executionSteps(trip({ scheduledPickupAt: null }));

    expect(isOverdue(steps[0]!, NOW)).toBe(false);
  });
});

describe('lateness is minutes, never a verdict', () => {
  it('is null when nothing was planned', () => {
    expect(lateByMinutes(null, null, NOW)).toBeNull();
  });

  it('measures to the reported time once it exists', () => {
    expect(lateByMinutes('2026-08-30T02:00:00Z', '2026-08-30T02:45:00Z', NOW)).toBe(45);
  });

  it('★ keeps growing while the step is unreported', () => {
    expect(lateByMinutes(EARLIER, null, NOW)).toBe(600);
  });

  it('reports zero rather than a negative for an early arrival', () => {
    expect(lateByMinutes('2026-08-30T02:00:00Z', '2026-08-30T01:30:00Z', NOW)).toBe(0);
  });

  it('applies no threshold at all — one minute is one minute', () => {
    expect(lateByMinutes('2026-08-30T02:00:00Z', '2026-08-30T02:01:00Z', NOW)).toBe(1);
  });
});

describe('which expense headings are offered', () => {
  it('offers all five on a company lorry', () => {
    expect(allowedCategories('company', TRIP_COST_CATEGORIES)).toHaveLength(5);
  });

  it('★ hides fuel and tolls on a hired lorry', () => {
    // The carrier absorbs both into its one agreed price; claiming either here
    // is the same money counted twice, and the server refuses it.
    expect(allowedCategories('outsourced', TRIP_COST_CATEGORIES)).toEqual([
      'warehouse',
      'loading',
      'overtime',
    ]);
  });

  it('★ keeps all five when nobody has classified the lorry', () => {
    // `null` means unclassified, never "hired". Hiding two headings on the
    // strength of a fact nobody stated would lose real money.
    expect(allowedCategories(null, TRIP_COST_CATEGORIES)).toHaveLength(5);
  });

  it('reads the ownership off the snapshot on an event', () => {
    expect(vehicleOwnershipOf(trip({ events: [event('ARRIVED_PICKUP', { vehicleOwnership: 'outsourced' })] }))).toBe(
      'outsourced',
    );
  });

  it('falls back to the snapshot on a declared line', () => {
    expect(vehicleOwnershipOf(trip({ expenses: [cost({ vehicleOwnership: 'outsourced' })] }))).toBe(
      'outsourced',
    );
  });

  it('answers null when nothing carries a snapshot yet', () => {
    expect(vehicleOwnershipOf(trip())).toBeNull();
  });
});

describe('when a figure may be corrected', () => {
  it('allows an editable line', () => {
    expect(isEditable(cost())).toBe(true);
  });

  it('★ refuses a locked line — a review is looking at it', () => {
    expect(isEditable(cost({ state: 'locked' }))).toBe(false);
  });

  it('★ refuses an immutable line — approval made it final', () => {
    expect(isEditable(cost({ state: 'immutable' }))).toBe(false);
  });

  it('refuses a withdrawn line', () => {
    expect(isEditable(cost({ voidedAt: EARLIER }))).toBe(false);
  });

  it('counts only live lines', () => {
    expect(liveExpenses([cost(), cost({ id: 'c2', voidedAt: EARLIER })])).toHaveLength(1);
  });
});

describe('when new figures may be declared', () => {
  it('allows it on an open trip with a lorry', () => {
    expect(canDeclareExpense(trip())).toBe(true);
  });

  it('★ refuses before a lorry is assigned', () => {
    expect(canDeclareExpense(trip({ vehicle: null }))).toBe(false);
  });

  it('refuses while a completion is under review', () => {
    expect(canDeclareExpense(trip({ completion: request({ state: 'pending' }) }))).toBe(false);
  });

  it('refuses once the trip is approved', () => {
    expect(canDeclareExpense(trip({ accountability: 'APPROVED_IMMUTABLE' }))).toBe(false);
  });
});

describe('the completion stage', () => {
  const reported = [
    event('ARRIVED_PICKUP'),
    event('PICKUP_CONFIRMED'),
    event('ARRIVED_DELIVERY'),
    event('DELIVERY_CONFIRMED'),
  ];

  it('is not ready while steps remain', () => {
    expect(completionStage(trip())).toBe('not-ready');
    expect(canSubmitCompletion(trip())).toBe(false);
  });

  it('becomes ready once all four are reported', () => {
    expect(completionStage(trip({ events: reported }))).toBe('ready');
    expect(canSubmitCompletion(trip({ events: reported }))).toBe(true);
  });

  it('reports a pending review', () => {
    const pending = trip({ events: reported, completion: request({ state: 'pending' }) });

    expect(completionStage(pending)).toBe('pending');
    expect(canSubmitCompletion(pending)).toBe(false);
  });

  it('★ reopens for a rejection, so the driver can correct and send again', () => {
    const rejected = trip({
      events: reported,
      completion: request({ state: 'rejected', decisionReason: 'Sai số tiền dầu.' }),
    });

    expect(completionStage(rejected)).toBe('rejected');
    expect(canSubmitCompletion(rejected)).toBe(true);
  });

  it('★ is terminal once approved, and offers nothing further', () => {
    const done = trip({
      events: reported,
      accountability: 'APPROVED_IMMUTABLE',
      completion: request({ state: 'approved' }),
    });

    expect(completionStage(done)).toBe('approved');
    expect(canSubmitCompletion(done)).toBe(false);
    expect(canDeclareExpense(done)).toBe(false);
  });
});

describe('the suggested declaration', () => {
  it('suggests "there were expenses" when lines exist', () => {
    expect(suggestedDeclaration(trip({ expenses: [cost()] }))).toBe('expenses');
  });

  it('suggests "none" when there are no live lines', () => {
    expect(suggestedDeclaration(trip({ expenses: [cost({ voidedAt: EARLIER })] }))).toBe('none');
  });
});

describe('★ the four workflow stages', () => {
  const states = (t: DriverTripDetail) => workflowStages(t).map((step) => step.state);
  const JOURNEY = (['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED'] as const).map((type) =>
    event(type),
  );

  it('starts on pickup', () => {
    expect(states(trip())).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(currentStage(trip())).toBe('pickup');
  });

  it('moves to delivery once the pickup is confirmed — an arrival alone does not', () => {
    expect(states(trip({ events: [event('ARRIVED_PICKUP')] }))).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(currentStage(trip({ events: [event('ARRIVED_PICKUP'), event('PICKUP_CONFIRMED')] }))).toBe('delivery');
  });

  it('reaches the expense checkpoint when the journey is reported', () => {
    expect(states(trip({ events: JOURNEY }))).toEqual(['done', 'done', 'current', 'upcoming']);
  });

  it('stays on the checkpoint after a rejection — the figures are open again', () => {
    const rejected = trip({ events: JOURNEY, completion: request({ state: 'rejected' }) });
    expect(states(rejected)).toEqual(['done', 'done', 'current', 'upcoming']);
  });

  it('is on the review while a request is pending', () => {
    const pending = trip({ events: JOURNEY, completion: request({ state: 'pending' }) });
    expect(states(pending)).toEqual(['done', 'done', 'done', 'current']);
    expect(currentStage(pending)).toBe('completion');
  });

  it('is all done once approved, with no current stage', () => {
    const approved = trip({ events: JOURNEY, accountability: 'APPROVED_IMMUTABLE', completion: request({ state: 'approved' }) });
    expect(states(approved)).toEqual(['done', 'done', 'done', 'done']);
    expect(currentStage(approved)).toBeNull();
  });
});
