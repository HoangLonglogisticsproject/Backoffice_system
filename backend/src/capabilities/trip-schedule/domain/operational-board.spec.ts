import { delayMinutes, stageOf, type OperationalFacts } from './operational-board';

/**
 * The nine questions the contract asks, as a truth table.
 *
 * ★ WHY THIS IS A PURE-FUNCTION TEST AND NOT AN INTEGRATION ONE. The stage is
 * the one part of the operational board that is a DECISION rather than a query:
 * given the same facts it must always produce the same answer, including at the
 * boundaries where two readings are both plausible. A database adds nothing to
 * that and makes the cases far harder to write.
 *
 * ⚠ NO CASE HERE ASSERTS A THRESHOLD, because there is none to assert. "Late"
 * means the planned time has passed and the event has not been reported — a
 * comparison, not a judgement. How many minutes is "a problem" has never been
 * decided, and this file deliberately does not decide it.
 */
const NOW = new Date('2026-08-30T12:00:00Z');
const EARLIER = new Date('2026-08-30T02:00:00Z');
const LATER = new Date('2026-08-30T20:00:00Z');

const facts = (over: Partial<OperationalFacts> = {}): OperationalFacts => ({
  hasActiveDriver: true,
  scheduledPickupAt: LATER,
  scheduledDeliveryAt: LATER,
  arrivedPickupAt: null,
  pickupConfirmedAt: null,
  arrivedDeliveryAt: null,
  deliveryConfirmedAt: null,
  completion: 'none',
  ...over,
});

describe('the operational stage', () => {
  it('reports a trip with a lorry and no driver', () => {
    expect(stageOf(facts({ hasActiveDriver: false }), NOW)).toBe('NO_DRIVER');
  });

  it('reports a driver who has reported nothing, before the pickup is due', () => {
    expect(stageOf(facts(), NOW)).toBe('WAITING_PICKUP');
  });

  it('reports a driver on a trip with no planned times at all', () => {
    // Nothing to be late against, so the honest answer is "assigned" rather
    // than a delay computed from a deadline nobody set.
    expect(
      stageOf(facts({ scheduledPickupAt: null, scheduledDeliveryAt: null }), NOW),
    ).toBe('DRIVER_ASSIGNED');
  });

  it('★ reports a pickup that is past its time with no arrival', () => {
    expect(stageOf(facts({ scheduledPickupAt: EARLIER }), NOW)).toBe('PICKUP_DELAYED');
  });

  it('★ never calls a trip late when nothing was planned', () => {
    expect(stageOf(facts({ scheduledPickupAt: null }), NOW)).toBe('DRIVER_ASSIGNED');
  });

  it('reports an arrival that has not been confirmed', () => {
    expect(stageOf(facts({ arrivedPickupAt: EARLIER }), NOW)).toBe('AT_PICKUP');
  });

  it('★ keeps reporting AT_PICKUP even once the delivery time has passed', () => {
    // The first unfinished step is what matters. A trip stuck at the loading
    // bay is not "delivery delayed" — it never left.
    expect(
      stageOf(facts({ arrivedPickupAt: EARLIER, scheduledDeliveryAt: EARLIER }), NOW),
    ).toBe('AT_PICKUP');
  });

  it('reports a loaded trip that is still within its delivery window', () => {
    expect(
      stageOf(facts({ arrivedPickupAt: EARLIER, pickupConfirmedAt: EARLIER }), NOW),
    ).toBe('IN_TRANSIT');
  });

  it('★ reports a loaded trip that is past its delivery time', () => {
    expect(
      stageOf(
        facts({
          arrivedPickupAt: EARLIER,
          pickupConfirmedAt: EARLIER,
          scheduledDeliveryAt: EARLIER,
        }),
        NOW,
      ),
    ).toBe('DELIVERY_DELAYED');
  });

  it('reports an arrival at the delivery that has not been confirmed', () => {
    expect(
      stageOf(
        facts({ arrivedPickupAt: EARLIER, pickupConfirmedAt: EARLIER, arrivedDeliveryAt: EARLIER }),
        NOW,
      ),
    ).toBe('AT_DELIVERY');
  });

  it('★ reports a delivered trip whose paperwork has not been sent', () => {
    expect(stageOf(facts({ deliveryConfirmedAt: EARLIER }), NOW)).toBe('AWAITING_COMPLETION');
  });

  it('reports a completion waiting on a reviewer', () => {
    expect(stageOf(facts({ deliveryConfirmedAt: EARLIER, completion: 'pending' }), NOW)).toBe(
      'COMPLETION_PENDING',
    );
  });

  it('★ reports a completion that was sent back', () => {
    expect(stageOf(facts({ deliveryConfirmedAt: EARLIER, completion: 'rejected' }), NOW)).toBe(
      'COMPLETION_REJECTED',
    );
  });

  it('reports a closed trip', () => {
    expect(stageOf(facts({ completion: 'approved' }), NOW)).toBe('DONE');
  });

  it('★ lets the completion state override an incomplete timeline', () => {
    // A driver who never reported the delivery but whose completion was
    // approved is DONE. The missing event is a real gap, and the place to see
    // it is the timeline columns — not by pretending the trip is still running.
    expect(stageOf(facts({ completion: 'approved' }), NOW)).toBe('DONE');
  });

  it('treats the deadline instant itself as not yet late', () => {
    // Strictly past, not "at or past": a trip due at noon is not late at noon.
    expect(stageOf(facts({ scheduledPickupAt: NOW }), NOW)).toBe('WAITING_PICKUP');
  });
});

describe('delay, as minutes rather than as a verdict', () => {
  it('is null when nothing was planned', () => {
    expect(delayMinutes(null, null, NOW)).toBeNull();
    expect(delayMinutes(null, EARLIER, NOW)).toBeNull();
  });

  it('measures to the reported time when there is one', () => {
    const scheduled = new Date('2026-08-30T02:00:00Z');
    const arrived = new Date('2026-08-30T02:45:00Z');

    expect(delayMinutes(scheduled, arrived, NOW)).toBe(45);
  });

  it('★ measures to NOW while the event is still unreported, so it keeps growing', () => {
    // Freezing this at zero would hide precisely the trips somebody needs to
    // chase — the ones that never reported at all.
    expect(delayMinutes(EARLIER, null, NOW)).toBe(600);
  });

  it('reports zero rather than a negative for an early arrival', () => {
    const scheduled = new Date('2026-08-30T02:00:00Z');
    const early = new Date('2026-08-30T01:30:00Z');

    expect(delayMinutes(scheduled, early, NOW)).toBe(0);
  });

  it('applies no threshold of any kind', () => {
    // One minute late is reported as one minute. Whether that matters is a
    // human judgement made from this number.
    const scheduled = new Date('2026-08-30T02:00:00Z');
    expect(delayMinutes(scheduled, new Date('2026-08-30T02:01:00Z'), NOW)).toBe(1);
  });
});
