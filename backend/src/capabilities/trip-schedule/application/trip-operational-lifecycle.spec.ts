import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain.error';
import type { Database, DatabaseQuery } from '../../../common/types/database.port';
import { accountabilityOf } from '../domain/trip-execution';
import { TripCompletionService } from './trip-completion.service';
import { TripCostService } from './trip-cost.service';
import { TripExecutionService } from './trip-execution.service';
import { TripScheduleService } from './trip-schedule.service';

/**
 * The operational lifecycle, without a database.
 *
 * ★ WHAT THIS CAN AND CANNOT PROVE. It proves the ORDER and the CONDITIONS: that
 * approving freezes the money before it closes the trip, that a rejection
 * reopens it, that an edit writes its log in the same call, that a driver
 * cannot report somebody else's trip. It cannot prove that PostgreSQL honours
 * any of it — that two approvers really do serialise, that
 * `uq_trip_active_driver_assignment` really refuses the second insert. Those
 * need a real server and live in the integration specs, which are currently
 * NOT RUN because no database is available.
 *
 * The fakes below are deliberately dumb: they record calls and return what they
 * are told to. A fake that reimplemented the SQL would be testing itself.
 */

const TRIP = 'trip-1';
const DRIVER = 'driver-1';
const OTHER = 'someone-else';
const BOSS = 'superadmin-1';
const VEHICLE = 'vehicle-1';

/** Runs the callback with a sentinel executor, so a caller can assert it was passed. */
const TX = { query: jest.fn() } as unknown as DatabaseQuery;
const database = (): Database =>
  ({
    query: jest.fn(),
    transaction: jest.fn(async (work: (tx: DatabaseQuery) => Promise<unknown>) => work(TX)),
  }) as unknown as Database;

const openTrip = (over: Record<string, unknown> = {}) => ({
  id: TRIP,
  status: 'awaiting_vehicle',
  vehicleId: VEHICLE,
  pickupAt: new Date('2026-08-30T02:00:00Z'),
  deliveryAt: new Date('2026-08-30T09:00:00Z'),
  ...over,
});

const activeAssignment = { id: 'assignment-1', tripId: TRIP, driverUserId: DRIVER, state: 'active' };

/** A user repository that knows one live driver. */
const drivers = () => ({
  findById: jest.fn().mockResolvedValue({ id: DRIVER, accountType: 'driver', status: 'active' }),
  listActiveByAccountType: jest.fn().mockResolvedValue([{ id: DRIVER, displayName: 'Tài Xế' }]),
});

/** A notification service that records what it was asked to record. */
const told = () => ({
  record: jest.fn().mockImplementation(async (input: unknown) => ({ id: 'note', ...(input as object) })),
  deliver: jest.fn(),
});

describe('completion', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const trips = {
      lockActive: jest.fn().mockResolvedValue(openTrip()),
      updateStatus: jest.fn().mockResolvedValue(openTrip({ status: 'done' })),
      markClosed: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      ...over,
    };
    const assignments = {
      lockActive: jest.fn().mockResolvedValue(activeAssignment),
      findActive: jest.fn().mockResolvedValue(activeAssignment),
    };
    const requests = {
      lockPending: jest.fn().mockResolvedValue(null),
      submit: jest.fn().mockResolvedValue({ id: 'request-1', attemptNo: 1, state: 'pending' }),
      decide: jest.fn().mockResolvedValue({ id: 'request-1', state: 'approved' }),
      listByTrip: jest.fn().mockResolvedValue([]),
    };
    const costs = {
      lockForTrip: jest.fn().mockResolvedValue(2),
      unlockForTrip: jest.fn().mockResolvedValue(2),
      finalizeForTrip: jest.fn().mockResolvedValue(2),
      // One live line, so the default declaration below is the consistent one.
      listActiveByTrip: jest.fn().mockResolvedValue([{ id: 'cost-1' }]),
    };
    const history = { record: jest.fn().mockResolvedValue(undefined) };
    const notifications = told();

    const service = new TripCompletionService(
      database(),
      trips as never,
      assignments as never,
      requests as never,
      costs as never,
      history as never,
      notifications as never,
    );

    return { service, trips, assignments, requests, costs, history, notifications };
  };

  describe('submit', () => {
    it('freezes the trip’s figures in the same call that records the request', async () => {
      // An approver reading a total that can still change is approving
      // something that no longer exists by the time they click.
      const { service, requests, costs } = build();

      await service.submit(TRIP, DRIVER, 'expenses');

      expect(requests.submit).toHaveBeenCalledWith(expect.objectContaining({ tripId: TRIP }), TX);
      expect(costs.lockForTrip).toHaveBeenCalledWith(TRIP, DRIVER, expect.any(Date), TX);
    });

    it('refuses a second request while one is waiting', async () => {
      const { service, requests } = build();
      requests.lockPending.mockResolvedValue({ id: 'request-1', state: 'pending' });

      await expect(service.submit(TRIP, DRIVER, 'expenses')).rejects.toThrow(ConflictError);
    });

    it('refuses somebody who is not the assigned driver', async () => {
      const { service } = build();
      await expect(service.submit(TRIP, OTHER, 'expenses')).rejects.toThrow(ConflictError);
    });

    it('refuses a trip that is already closed', async () => {
      const { service, trips } = build();
      trips.lockActive.mockResolvedValue(openTrip({ status: 'done' }));

      await expect(service.submit(TRIP, DRIVER, 'expenses')).rejects.toThrow(ConflictError);
    });
  });

  describe('the expense declaration', () => {
    it('is stored as the driver stated it, on every attempt', async () => {
      const { service, requests, costs } = build();
      costs.listActiveByTrip.mockResolvedValue([]);

      await service.submit(TRIP, DRIVER, 'none');

      expect(requests.submit).toHaveBeenCalledWith(
        expect.objectContaining({ expenseDeclaration: 'none' }),
        TX,
      );
    });

    it('refuses "nothing to claim" when the trip has expenses on it', async () => {
      // Both halves come from the same person, so a disagreement is a mistake —
      // and it would make DECLARED_NO_EXPENSE unreadable.
      const { service } = build();

      await expect(service.submit(TRIP, DRIVER, 'none')).rejects.toThrow(ConflictError);
    });

    it('refuses "there were expenses" when none have been entered', async () => {
      const { service, costs } = build();
      costs.listActiveByTrip.mockResolvedValue([]);

      await expect(service.submit(TRIP, DRIVER, 'expenses')).rejects.toThrow(ConflictError);
    });

    it('counts only live lines, so a voided one does not force a declaration', async () => {
      const { service, costs, requests } = build();
      // `listActiveByTrip` already excludes voided rows; this asserts the
      // service asks for the live list rather than the whole history.
      costs.listActiveByTrip.mockResolvedValue([]);

      await service.submit(TRIP, DRIVER, 'none');

      expect(costs.listActiveByTrip).toHaveBeenCalledWith(TRIP, TX);
      expect(requests.submit).toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    const approving = () => {
      const built = build();
      built.requests.lockPending.mockResolvedValue({ id: 'request-1', state: 'pending' });
      return built;
    };

    it('freezes the money BEFORE it closes the trip', async () => {
      // ★ THE ORDER IS THE ASSERTION. Reversed, there is an instant in which a
      // closed trip still carries an editable figure.
      const { service, costs, trips } = approving();
      const order: string[] = [];
      costs.finalizeForTrip.mockImplementation(async () => {
        order.push('finalize');
        return 2;
      });
      trips.updateStatus.mockImplementation(async () => {
        order.push('close');
        return openTrip({ status: 'done' });
      });

      await service.approve(TRIP, BOSS);

      expect(order).toEqual(['finalize', 'close']);
    });

    it('records the move and stamps who closed it, in the same transaction', async () => {
      const { service, history, trips } = approving();
      trips.lockActive.mockResolvedValue(openTrip({ status: 'needs_confirmation' }));

      await service.approve(TRIP, BOSS);

      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'needs_confirmation', to: 'done', changedBy: BOSS }),
        TX,
      );
      expect(trips.markClosed).toHaveBeenCalledWith(TRIP, BOSS, expect.any(Date), TX);
    });

    it('aborts the whole approval when freezing the money fails', async () => {
      // ★ WHAT THIS ACTUALLY PROVES, AND WHAT IT DOES NOT. It proves the service
      // stops: the trip is never marked done and never stamped. It does NOT
      // prove PostgreSQL rolls the transaction back — that needs a real server,
      // and that assertion lives in the integration spec, which is NOT RUN.
      const { service, costs, trips, history } = approving();
      costs.finalizeForTrip.mockRejectedValue(new Error('deadlock detected'));

      await expect(service.approve(TRIP, BOSS)).rejects.toThrow('deadlock detected');

      expect(trips.updateStatus).not.toHaveBeenCalled();
      expect(trips.markClosed).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('aborts before closing when the status write fails', async () => {
      const { service, trips, history } = approving();
      trips.updateStatus.mockRejectedValue(new Error('serialization failure'));

      await expect(service.approve(TRIP, BOSS)).rejects.toThrow('serialization failure');

      expect(history.record).not.toHaveBeenCalled();
      expect(trips.markClosed).not.toHaveBeenCalled();
    });

    it('refuses when there is nothing waiting to decide', async () => {
      const { service } = build();
      await expect(service.approve(TRIP, BOSS)).rejects.toThrow(ConflictError);
    });

    it('turns a lost race into a conflict rather than overwriting the first decision', async () => {
      // The second approver's UPDATE carries `WHERE state = 'pending'` and gets
      // no row back. Anything other than a refusal here would silently rewrite
      // who approved the trip.
      const { service, requests } = build();
      requests.lockPending.mockResolvedValue({ id: 'request-1', state: 'pending' });
      requests.decide.mockResolvedValue(null);

      await expect(service.approve(TRIP, BOSS)).rejects.toThrow(ConflictError);
    });
  });

  describe('reject', () => {
    const rejecting = () => {
      const built = build();
      built.requests.lockPending.mockResolvedValue({ id: 'request-1', state: 'pending' });
      built.requests.decide.mockResolvedValue({ id: 'request-1', state: 'rejected' });
      return built;
    };

    it('reopens the figures, because locking was only ever temporary', async () => {
      const { service, costs } = rejecting();

      await service.reject(TRIP, { by: BOSS, reason: 'Thiếu chứng từ dầu.' });

      expect(costs.unlockForTrip).toHaveBeenCalledWith(TRIP, TX);
      expect(costs.finalizeForTrip).not.toHaveBeenCalled();
    });

    it('leaves the trip’s status alone', async () => {
      const { service, trips } = rejecting();

      await service.reject(TRIP, { by: BOSS, reason: 'Thiếu chứng từ dầu.' });

      expect(trips.updateStatus).not.toHaveBeenCalled();
      expect(trips.markClosed).not.toHaveBeenCalled();
    });

    it('refuses a rejection with no reason the driver can act on', async () => {
      const { service } = rejecting();
      await expect(service.reject(TRIP, { by: BOSS, reason: '   ' })).rejects.toThrow(
        ValidationError,
      );
    });

    it('passes the trimmed reason through to the decision', async () => {
      const { service, requests } = rejecting();

      await service.reject(TRIP, { by: BOSS, reason: '  Sai số tiền dầu.  ' });

      expect(requests.decide).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'rejected', reason: 'Sai số tiền dầu.' }),
        TX,
      );
    });
  });
});

describe('the one write path to DONE', () => {
  const build = () => {
    const trips = {
      lockActive: jest.fn().mockResolvedValue(openTrip()),
      create: jest.fn().mockResolvedValue(openTrip()),
      replace: jest.fn().mockResolvedValue(openTrip()),
      updateStatus: jest.fn().mockResolvedValue(openTrip({ status: 'done' })),
      markClosed: jest.fn(),
      exists: jest.fn().mockResolvedValue(true),
    };
    const history = { record: jest.fn().mockResolvedValue(undefined) };
    const catalogue = { findById: jest.fn().mockResolvedValue({ id: VEHICLE, status: 'active' }) };

    const service = new TripScheduleService(
      database(),
      trips as never,
      catalogue as never,
      catalogue as never,
      history as never,
    );

    return { service, trips, history };
  };

  it('refuses to move a trip to DONE from the status route', async () => {
    // ★ Completing a trip freezes its money, stamps who closed it and writes
    // the history — all in one transaction, in the completion service. A status
    // route that could also write `done` would skip every one of those, and
    // 0017's trigger would then make the result permanent.
    const { service, trips } = build();

    await expect(service.updateStatus(TRIP, 'done', BOSS)).rejects.toThrow(ConflictError);
    expect(trips.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses to move a trip to DONE from the general patch route', async () => {
    // `status` is a field of the patch body, which makes this the easier of the
    // two routes to forget.
    const { service, trips } = build();

    await expect(service.update(TRIP, { status: 'done' }, BOSS)).rejects.toThrow(ConflictError);
    expect(trips.replace).not.toHaveBeenCalled();
  });

  it('refuses to CREATE a trip that is already DONE', async () => {
    // ★ A single POST would otherwise produce a permanently closed trip with no
    // completion request, no approver and no frozen figures.
    const { service, trips } = build();

    await expect(
      service.create({ scheduledOn: '2026-08-30', status: 'done', createdBy: BOSS }),
    ).rejects.toThrow(ConflictError);
    expect(trips.create).not.toHaveBeenCalled();
  });

  it('still refuses to reopen a completed trip', async () => {
    const { service, trips } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'done' }));

    await expect(service.updateStatus(TRIP, 'awaiting_vehicle', BOSS)).rejects.toThrow(
      ConflictError,
    );
  });

  it('allows every ordinary board move, and records each one', async () => {
    const { service, trips, history } = build();
    trips.updateStatus.mockResolvedValue(openTrip({ status: 'needs_confirmation' }));

    await service.updateStatus(TRIP, 'needs_confirmation', BOSS, 'Khách đổi giờ.');

    expect(trips.updateStatus).toHaveBeenCalledWith(TRIP, 'needs_confirmation', TX);
    expect(history.record).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'awaiting_vehicle',
        to: 'needs_confirmation',
        reason: 'Khách đổi giờ.',
        changedBy: BOSS,
      }),
      TX,
    );
  });

  it('never stamps closed_at from a board move, because it can never reach DONE', async () => {
    const { service, trips } = build();
    trips.updateStatus.mockResolvedValue(openTrip({ status: 'external_booking' }));

    await service.updateStatus(TRIP, 'external_booking', BOSS);

    expect(trips.markClosed).not.toHaveBeenCalled();
  });

  it('writes no history when the status is set to what it already is', async () => {
    const { service, trips, history } = build();

    await service.updateStatus(TRIP, 'awaiting_vehicle', BOSS);

    expect(trips.updateStatus).not.toHaveBeenCalled();
    expect(history.record).not.toHaveBeenCalled();
  });

  it('records the opening status when a trip is created', async () => {
    const { service, history } = build();

    await service.create({ scheduledOn: '2026-08-30', createdBy: BOSS });

    expect(history.record).toHaveBeenCalledWith(
      expect.objectContaining({ from: null, changedBy: BOSS }),
      TX,
    );
  });
});

describe('expense accountability, as a read model', () => {
  const request = (over: Record<string, unknown> = {}) =>
    ({
      id: 'request-1',
      state: 'pending',
      attemptNo: 1,
      expenseDeclaration: 'expenses',
      ...over,
    }) as never;

  it('★ tells NOT_DECLARED apart from DECLARED_NO_EXPENSE', () => {
    // Both show no money. One is an outstanding obligation and the other is a
    // finished trip — a dashboard that merges them hides the trips to chase.
    expect(accountabilityOf([])).toBe('NOT_DECLARED');
    expect(accountabilityOf([request({ expenseDeclaration: 'none' })])).toBe(
      'DECLARED_NO_EXPENSE',
    );
  });

  it('reports a declared trip with expenses', () => {
    expect(accountabilityOf([request({ expenseDeclaration: 'expenses' })])).toBe(
      'DECLARED_WITH_EXPENSE',
    );
  });

  it('reports a rejected trip as needing correction', () => {
    expect(accountabilityOf([request({ state: 'rejected' })])).toBe(
      'REJECTED_NEEDS_CORRECTION',
    );
  });

  it('lets a fresh attempt supersede an older rejection', () => {
    // Newest attempt first. A trip being worked on is not a trip needing
    // correction.
    const history = [
      request({ attemptNo: 2, state: 'pending', expenseDeclaration: 'expenses' }),
      request({ attemptNo: 1, state: 'rejected' }),
    ];

    expect(accountabilityOf(history)).toBe('DECLARED_WITH_EXPENSE');
  });

  it('lets approval win over everything in the history', () => {
    const history = [
      request({ attemptNo: 2, state: 'approved' }),
      request({ attemptNo: 1, state: 'rejected' }),
    ];

    expect(accountabilityOf(history)).toBe('APPROVED_IMMUTABLE');
  });
});

describe('execution events', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const trips = { lockActive: jest.fn().mockResolvedValue(openTrip()), exists: jest.fn() };
    const assignments = { lockActive: jest.fn().mockResolvedValue(activeAssignment) };
    const events = {
      findByClientEventId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue({ id: 'event-1' }),
      // The journey so far. Empty means nothing reported yet, so only
      // ARRIVED_PICKUP is admissible — the ordering rule reads this.
      listByTrip: jest.fn().mockResolvedValue([]),
      void: jest.fn(),
      ...over,
    };
    const vehicles = { findById: jest.fn().mockResolvedValue({ id: VEHICLE, ownership: 'company' }) };
    const users = drivers();
    const notifications = told();

    const service = new TripExecutionService(
      database(),
      trips as never,
      assignments as never,
      events as never,
      vehicles as never,
      users as never,
      notifications as never,
    );

    return { service, trips, assignments, events, vehicles, users, notifications };
  };

  const arriving = {
    tripId: TRIP,
    type: 'ARRIVED_PICKUP' as const,
    actualAt: new Date('2026-08-30T02:31:00Z'),
    clientEventId: 'tap-1',
    recordedBy: DRIVER,
  };

  it('snapshots the PICKUP time for a pickup event', async () => {
    // ★ THE WRONG SCHEDULE PRODUCES A DELAY WRONG BY THE LENGTH OF THE JOURNEY.
    const { service, events } = build();

    await service.recordEvent(arriving);

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: new Date('2026-08-30T02:00:00Z') }),
      TX,
    );
  });

  it('snapshots the DELIVERY time for a delivery event', async () => {
    const { service, events } = build();
    // The two pickup milestones already stand, so a delivery arrival is
    // admissible — see the ordering rule.
    events.listByTrip.mockResolvedValue([
      { type: 'ARRIVED_PICKUP' },
      { type: 'PICKUP_CONFIRMED' },
    ]);

    await service.recordEvent({ ...arriving, type: 'ARRIVED_DELIVERY', clientEventId: 'tap-2' });

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: new Date('2026-08-30T09:00:00Z') }),
      TX,
    );
  });

  it('copies the vehicle and its ownership beside the event', async () => {
    const { service, events } = build();

    await service.recordEvent(arriving);

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: VEHICLE, vehicleOwnership: 'company' }),
      TX,
    );
  });

  it('records an unclassified lorry as null, never as company', async () => {
    // ★ 0013 leaves every existing lorry unclassified on purpose. Substituting
    // a value here would be the system asserting a fact nobody stated.
    const { service, events, vehicles } = build();
    vehicles.findById.mockResolvedValue({ id: VEHICLE, ownership: null });

    await service.recordEvent(arriving);

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleOwnership: null }),
      TX,
    );
  });

  it('answers a retry with the event it already wrote', async () => {
    // A driver on a bad connection did nothing wrong; the honest answer to
    // "record this arrival" that is already recorded is the arrival.
    const { service, events } = build();
    events.findByClientEventId.mockResolvedValue({ id: 'event-1', type: 'ARRIVED_PICKUP' });

    const result = await service.recordEvent(arriving);

    expect(result).toEqual({ id: 'event-1', type: 'ARRIVED_PICKUP' });
    expect(events.record).not.toHaveBeenCalled();
  });

  it('refuses to let one driver report another driver’s trip', async () => {
    const { service } = build();
    await expect(service.recordEvent({ ...arriving, recordedBy: OTHER })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('refuses a trip with no driver, which has nothing to report against', async () => {
    const { service, assignments } = build();
    assignments.lockActive.mockResolvedValue(null);

    await expect(service.recordEvent(arriving)).rejects.toThrow(ConflictError);
  });

  it('refuses a closed trip', async () => {
    const { service, trips } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'done' }));

    await expect(service.recordEvent(arriving)).rejects.toThrow(ConflictError);
  });

  it('refuses a blank client event id, which would defeat retry protection', async () => {
    const { service } = build();
    await expect(service.recordEvent({ ...arriving, clientEventId: '  ' })).rejects.toThrow(
      ValidationError,
    );
  });

  /**
   * ★ THE GEOFENCE IS THE SERVICE'S DECISION, MADE FROM THE TRIP'S OWN POINT.
   *
   * The reading comes from the client; the verdict never does. Every case here
   * hands the service a reading and asserts what it WROTE — `geofencePassed`
   * and `distanceM` are computed inside the transaction, and a refusal writes
   * nothing at all.
   */
  describe('confirming a pickup', () => {
    /** Tân Sơn Nhất cargo, roughly. */
    const PICKUP = { pickupLatitude: 10.8188, pickupLongitude: 106.6564 };
    const SENT_AT = new Date('2026-08-30T02:31:00Z');
    const goodFix = {
      latitude: 10.8188,
      longitude: 106.6564,
      accuracyM: 12,
      capturedAt: new Date(SENT_AT.getTime() - 5_000),
    };

    const located = (over: Record<string, unknown> = {}) => {
      const built = build({
        // The arrival already stands, so a confirmation is admissible.
        listByTrip: jest.fn().mockResolvedValue([{ type: 'ARRIVED_PICKUP' }]),
      });
      built.trips.lockActive.mockResolvedValue(openTrip({ ...PICKUP, ...over }));
      return built;
    };

    const confirming = {
      tripId: TRIP,
      type: 'PICKUP_CONFIRMED' as const,
      deviceReportedAt: SENT_AT,
      clientEventId: 'tap-2',
      recordedBy: DRIVER,
    };

    const rejected = async (
      service: TripExecutionService,
      input: Parameters<TripExecutionService['recordEvent']>[0],
      reason: string,
    ) => {
      const failure = await service.recordEvent(input).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ValidationError);
      expect((failure as ValidationError).details).toEqual({ location: reason });
    };

    it('★ writes the verdict and the distance it computed, beside the reading', async () => {
      const { service, events } = located();

      await service.recordEvent({ ...confirming, location: goodFix });

      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PICKUP_CONFIRMED',
          location: goodFix,
          geofencePassed: true,
          distanceM: 0,
        }),
        TX,
      );
    });

    it('★ stamps actual_at from the SERVER, not from the fix', async () => {
      const { service, events } = located();
      const before = Date.now();

      await service.recordEvent({ ...confirming, location: goodFix });

      const written = events.record.mock.calls[0][0] as { actualAt: Date; deviceReportedAt: Date };
      expect(written.actualAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(written.actualAt.getTime()).toBeLessThanOrEqual(Date.now());
      // Neither handset stamp is the business time; both are kept beside it.
      expect(written.actualAt).not.toEqual(goodFix.capturedAt);
      expect(written.deviceReportedAt).toEqual(SENT_AT);
    });

    it('refuses a confirmation with no reading, and writes nothing', async () => {
      const { service, events } = located();

      await rejected(service, confirming, 'LOCATION_REQUIRED');
      expect(events.record).not.toHaveBeenCalled();
    });

    it('★ refuses when the trip has no pickup coordinates — the office’s problem, named as such', async () => {
      const { service, events } = located({ pickupLatitude: null, pickupLongitude: null });

      await rejected(service, { ...confirming, location: goodFix }, 'DESTINATION_MISSING');
      expect(events.record).not.toHaveBeenCalled();
    });

    it('refuses a reading outside the radius', async () => {
      const { service, events } = located();
      // ~1.1 km north.
      const far = { ...goodFix, latitude: goodFix.latitude + 0.01 };

      await rejected(service, { ...confirming, location: far }, 'OUTSIDE_GEOFENCE');
      expect(events.record).not.toHaveBeenCalled();
    });

    it('refuses a reading too loose to place the lorry', async () => {
      const { service } = located();
      await rejected(
        service,
        { ...confirming, location: { ...goodFix, accuracyM: 750 } },
        'ACCURACY_INSUFFICIENT',
      );
    });

    it('refuses a fix older than the freshness window', async () => {
      const { service } = located();
      const old = { ...goodFix, capturedAt: new Date(SENT_AT.getTime() - 10 * 60_000) };
      await rejected(service, { ...confirming, location: old }, 'LOCATION_STALE');
    });

    it('★ ages the fix against the handset’s own send time, so a wrong clock cancels out', async () => {
      // Both stamps five years behind; five seconds apart. Fresh.
      const { service, events } = located();
      const sentAt = new Date('2021-01-01T00:00:00Z');
      const fix = { ...goodFix, capturedAt: new Date(sentAt.getTime() - 5_000) };

      await service.recordEvent({ ...confirming, deviceReportedAt: sentAt, location: fix });

      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ geofencePassed: true }),
        TX,
      );
    });

    it('answers a retry with the event already written, BEFORE any location check', async () => {
      // A retry after a timeout carries no new reading and must not need one:
      // the pickup already happened.
      const { service, events } = located();
      events.findByClientEventId.mockResolvedValue({ id: 'event-2', type: 'PICKUP_CONFIRMED' });

      const result = await service.recordEvent(confirming);

      expect(result).toEqual({ id: 'event-2', type: 'PICKUP_CONFIRMED' });
      expect(events.record).not.toHaveBeenCalled();
    });

    it('still checks ownership before location, so the refusal is the right one', async () => {
      const { service, assignments } = located();
      assignments.lockActive.mockResolvedValue({ ...activeAssignment, driverUserId: OTHER });

      await expect(service.recordEvent({ ...confirming, location: goodFix })).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('records an arrival without a reading, with no verdict', async () => {
      const { service, events } = build();

      await service.recordEvent(arriving);

      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ location: null, geofencePassed: null, distanceM: null }),
        TX,
      );
    });

    it('keeps a reading sent with an arrival as evidence, but reaches no verdict on it', async () => {
      const { service, events } = build();

      await service.recordEvent({ ...arriving, location: goodFix });

      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ location: goodFix, geofencePassed: null, distanceM: null }),
        TX,
      );
    });
  });
});

describe('driver assignment', () => {
  const build = () => {
    const trips = { lockActive: jest.fn().mockResolvedValue(openTrip()), exists: jest.fn() };
    const users = drivers();
    const notifications = told();
    const assignments = {
      lockActive: jest.fn().mockResolvedValue(null),
      assign: jest.fn().mockResolvedValue({ id: 'assignment-2', driverUserId: OTHER }),
      end: jest.fn().mockResolvedValue({ id: 'assignment-1', state: 'ended' }),
    };
    const service = new TripExecutionService(
      database(),
      trips as never,
      assignments as never,
      { findByClientEventId: jest.fn() } as never,
      { findById: jest.fn() } as never,
      users as never,
      notifications as never,
    );
    return { service, trips, assignments, users, notifications };
  };

  it('refuses a second driver rather than silently replacing the first', async () => {
    const { service, assignments } = build();
    assignments.lockActive.mockResolvedValue(activeAssignment);

    await expect(service.assign(TRIP, OTHER, BOSS)).rejects.toThrow(ConflictError);
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('ends the previous turn before starting the new one, never overwriting it', async () => {
    // ★ Overwriting `driver_user_id` would destroy the answer to "who was
    // driving when this expense was recorded".
    const { service, assignments } = build();
    assignments.lockActive.mockResolvedValue(activeAssignment);
    const order: string[] = [];
    assignments.end.mockImplementation(async () => {
      order.push('end');
      return { id: 'assignment-1', state: 'ended' };
    });
    assignments.assign.mockImplementation(async () => {
      order.push('assign');
      return { id: 'assignment-2' };
    });

    await service.replaceDriver(TRIP, OTHER, { by: BOSS, reason: 'Tài xế báo ốm.' });

    expect(order).toEqual(['end', 'assign']);
  });

  it('refuses a driver change with no reason', async () => {
    const { service } = build();
    await expect(service.replaceDriver(TRIP, OTHER, { by: BOSS, reason: '' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('refuses to replace a driver with the same driver', async () => {
    const { service, assignments } = build();
    assignments.lockActive.mockResolvedValue(activeAssignment);

    await expect(
      service.replaceDriver(TRIP, DRIVER, { by: BOSS, reason: 'Nhầm.' }),
    ).rejects.toThrow(ConflictError);
  });
});

describe('a driver’s declared expense', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const trips = {
      lockActive: jest.fn().mockResolvedValue(openTrip()),
      exists: jest.fn().mockResolvedValue(true),
    };
    const costs = {
      findByClientRequestId: jest.fn().mockResolvedValue(null),
      declare: jest.fn().mockResolvedValue({ id: 'cost-1' }),
      lockById: jest.fn(),
      editEditable: jest.fn(),
      recordEdits: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      listEdits: jest.fn(),
      ...over,
    };
    const assignments = { lockActive: jest.fn().mockResolvedValue(activeAssignment) };
    const vehicles = { findById: jest.fn().mockResolvedValue({ id: VEHICLE, ownership: 'company' }) };

    const service = new TripCostService(
      database(),
      trips as never,
      costs as never,
      {} as never,
      {} as never,
      assignments as never,
      vehicles as never,
    );

    return { service, trips, costs, assignments, vehicles };
  };

  const declaring = {
    tripId: TRIP,
    category: 'fuel' as const,
    amount: '1500000.00',
    declaredBy: DRIVER,
  };

  it('writes the assignment and both snapshots alongside the figure', async () => {
    const { service, costs } = build();

    await service.declareCost(declaring);

    expect(costs.declare).toHaveBeenCalledWith(
      expect.objectContaining({
        driverAssignmentId: 'assignment-1',
        vehicleId: VEHICLE,
        vehicleOwnership: 'company',
      }),
      TX,
    );
  });

  it('refuses fuel on a hired lorry, which the carrier already charges for', async () => {
    const { service, vehicles } = build();
    vehicles.findById.mockResolvedValue({ id: VEHICLE, ownership: 'outsourced' });

    await expect(service.declareCost(declaring)).rejects.toThrow(ValidationError);
  });

  it('allows warehouse fees on a hired lorry, which are ours', async () => {
    const { service, vehicles, costs } = build();
    vehicles.findById.mockResolvedValue({ id: VEHICLE, ownership: 'outsourced' });

    await service.declareCost({ ...declaring, category: 'warehouse' });

    expect(costs.declare).toHaveBeenCalled();
  });

  it('refuses a trip with no lorry yet — there is nothing to spend on', async () => {
    const { service, trips } = build();
    trips.lockActive.mockResolvedValue(openTrip({ vehicleId: null }));

    await expect(service.declareCost(declaring)).rejects.toThrow(ConflictError);
  });

  it('refuses somebody who is not the assigned driver', async () => {
    const { service } = build();
    await expect(service.declareCost({ ...declaring, declaredBy: OTHER })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('answers a retry with the line it already wrote', async () => {
    const { service, costs } = build();
    costs.findByClientRequestId.mockResolvedValue({ id: 'cost-1', amount: '1500000.00' });

    const result = await service.declareCost({ ...declaring, clientRequestId: 'tap-1' });

    expect(result).toEqual({ id: 'cost-1', amount: '1500000.00' });
    expect(costs.declare).not.toHaveBeenCalled();
  });
});

describe('correcting a declared expense', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: 'cost-1',
    tripId: TRIP,
    category: 'fuel',
    amount: '1500000.00',
    note: null,
    state: 'editable',
    source: 'driver_portal',
    createdBy: DRIVER,
    voidedAt: null,
    ...over,
  });

  const build = (current: Record<string, unknown>) => {
    const costs = {
      lockById: jest.fn().mockResolvedValue(current),
      editEditable: jest.fn().mockResolvedValue({ ...current, amount: '1550000.00' }),
      recordEdits: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TripCostService(
      database(),
      { exists: jest.fn() } as never,
      costs as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, costs };
  };

  it('logs every field that moved, with the value before and after', async () => {
    const { service, costs } = build(line());

    await service.editCost(TRIP, 'cost-1', { amount: '1550000.00' }, DRIVER);

    expect(costs.recordEdits).toHaveBeenCalledWith(
      'cost-1',
      [{ field: 'amount', from: '1500000.00', to: '1550000.00' }],
      DRIVER,
      TX,
    );
  });

  it('writes nothing at all when the values are unchanged', async () => {
    // A repeated save is harmless; a log full of entries in which nothing
    // changed is a log nobody reads.
    const { service, costs } = build(line());

    await service.editCost(TRIP, 'cost-1', { amount: '1500000.00' }, DRIVER);

    expect(costs.editEditable).not.toHaveBeenCalled();
    expect(costs.recordEdits).not.toHaveBeenCalled();
  });

  it('refuses a line frozen by a pending completion', async () => {
    const { service } = build(line({ state: 'locked' }));

    await expect(service.editCost(TRIP, 'cost-1', { amount: '9.00' }, DRIVER)).rejects.toThrow(
      ConflictError,
    );
  });

  it('refuses a line that approval made final', async () => {
    const { service } = build(line({ state: 'immutable' }));

    await expect(service.editCost(TRIP, 'cost-1', { amount: '9.00' }, DRIVER)).rejects.toThrow(
      ConflictError,
    );
  });

  it('refuses a backoffice line, which is corrected by voiding', async () => {
    // ★ 0012's rule is untouched for the rows it was written for.
    const { service } = build(line({ source: 'backoffice', state: 'editable' }));

    await expect(service.editCost(TRIP, 'cost-1', { amount: '9.00' }, DRIVER)).rejects.toThrow(
      ConflictError,
    );
  });

  it('refuses a driver correcting somebody else’s figure', async () => {
    const { service } = build(line());

    await expect(service.editCost(TRIP, 'cost-1', { amount: '9.00' }, OTHER)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('turns a concurrent submit into a conflict rather than a missing row', async () => {
    const { service, costs } = build(line());
    costs.editEditable.mockResolvedValue(null);

    await expect(
      service.editCost(TRIP, 'cost-1', { amount: '1550000.00' }, DRIVER),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses an amount NUMERIC(14,2) cannot hold exactly', async () => {
    const { service } = build(line());

    await expect(service.editCost(TRIP, 'cost-1', { amount: '10.005' }, DRIVER)).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('withdrawing an immutable figure', () => {
  const immutable = {
    id: 'cost-1',
    tripId: TRIP,
    state: 'immutable',
    source: 'driver_portal',
    amount: '1500000.00',
    voidedAt: null,
  };

  const build = () => {
    const costs = {
      findById: jest.fn().mockResolvedValue(immutable),
      void: jest.fn().mockResolvedValue({
        ...immutable,
        voidedAt: new Date('2026-08-31T03:00:00Z'),
        voidedBy: BOSS,
        voidReason: 'Chứng từ trùng.',
      }),
    };
    const service = new TripCostService(
      database(),
      { exists: jest.fn() } as never,
      costs as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, costs };
  };

  it('still works, because a void is not an edit', async () => {
    // ★ 0016's T2 trigger deliberately leaves the void trio writable on an
    // immutable row. Withdrawing a figure does not change what it WAS; it
    // records that it no longer counts. The existing `cost.void` route depends
    // on this, and nothing here narrows it.
    const { service, costs } = build();

    const result = await service.voidCost(TRIP, 'cost-1', {
      by: BOSS,
      reason: 'Chứng từ trùng.',
    });

    expect(costs.void).toHaveBeenCalledWith('cost-1', BOSS, 'Chứng từ trùng.', expect.any(Date));
    expect(result.voidReason).toBe('Chứng từ trùng.');
  });

  it('keeps who, when and why on the withdrawn row', async () => {
    const { service } = build();

    const result = await service.voidCost(TRIP, 'cost-1', { by: BOSS, reason: 'Chứng từ trùng.' });

    expect(result.voidedBy).toBe(BOSS);
    expect(result.voidedAt).toBeInstanceOf(Date);
    expect(result.voidReason).toBe('Chứng từ trùng.');
  });

  it('refuses a withdrawal with no reason', async () => {
    const { service } = build();

    await expect(service.voidCost(TRIP, 'cost-1', { by: BOSS, reason: '   ' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('★ cannot be used to change the figure — void carries no new amount', () => {
    // The only route to `void` takes a reason and nothing else. There is no
    // parameter through which a caller could alter the amount while voiding, so
    // "void as a hidden edit" is unspellable rather than merely discouraged.
    const { service } = build();

    // `toHaveLength` on a FUNCTION reads its arity — three declared parameters,
    // none of which is an amount.
    expect(service.voidCost).toHaveLength(3);
  });

  it('refuses a second withdrawal rather than rewriting the first', async () => {
    const { service, costs } = build();
    costs.findById.mockResolvedValue({ ...immutable, voidedAt: new Date() });

    await expect(service.voidCost(TRIP, 'cost-1', { by: BOSS, reason: 'Lại nữa.' })).rejects.toThrow(
      ConflictError,
    );
  });
});

describe('★ assignment eligibility and what the driver is told', () => {
  const build = () => {
    const trips = { lockActive: jest.fn().mockResolvedValue(openTrip()), exists: jest.fn() };
    const users = drivers();
    const notifications = told();
    const assignments = {
      lockActive: jest.fn().mockResolvedValue(null),
      assign: jest.fn().mockResolvedValue({ ...activeAssignment, id: 'assignment-2' }),
      end: jest.fn().mockResolvedValue({ ...activeAssignment, state: 'ended' }),
    };
    const service = new TripExecutionService(
      database(),
      trips as never,
      assignments as never,
      { findByClientEventId: jest.fn() } as never,
      { findById: jest.fn() } as never,
      users as never,
      notifications as never,
    );
    return { service, trips, assignments, users, notifications };
  };

  it('refuses a person who does not exist', async () => {
    const { service, users } = build();
    users.findById.mockResolvedValue(null);
    await expect(service.assign(TRIP, 'nobody', BOSS)).rejects.toThrow(NotFoundError);
  });

  it('★ refuses an employee account — only a driver account drives', async () => {
    const { service, users, assignments } = build();
    users.findById.mockResolvedValue({ id: OTHER, accountType: 'employee', status: 'active' });

    await expect(service.assign(TRIP, OTHER, BOSS)).rejects.toThrow(ValidationError);
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('refuses a disabled driver account', async () => {
    const { service, users, assignments } = build();
    users.findById.mockResolvedValue({ id: DRIVER, accountType: 'driver', status: 'disabled' });

    await expect(service.assign(TRIP, DRIVER, BOSS)).rejects.toThrow(ConflictError);
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('refuses a closed trip before looking at the driver', async () => {
    const { service, trips, users } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'done' }));

    await expect(service.assign(TRIP, DRIVER, BOSS)).rejects.toThrow(ConflictError);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('★ records TRIP_ASSIGNED inside the transaction and delivers it after', async () => {
    const { service, notifications } = build();

    await service.assign(TRIP, DRIVER, BOSS);

    expect(notifications.record).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: DRIVER,
        type: 'TRIP_ASSIGNED',
        tripId: TRIP,
        eventKey: 'assignment:assignment-2:assigned',
      }),
      TX,
    );
    expect(notifications.deliver).toHaveBeenCalledTimes(1);
    expect(notifications.deliver.mock.calls[0][0]).toHaveLength(1);
  });

  it('★ delivers nothing the transaction did not write', async () => {
    const { service, assignments, notifications } = build();
    assignments.assign.mockRejectedValue(new Error('unique index'));

    await expect(service.assign(TRIP, DRIVER, BOSS)).rejects.toThrow('unique index');
    expect(notifications.deliver).not.toHaveBeenCalled();
  });

  it('★ tells both drivers on a replacement, each about their own turn', async () => {
    const { service, assignments, users, notifications } = build();
    assignments.lockActive.mockResolvedValue(activeAssignment);
    users.findById.mockResolvedValue({ id: OTHER, accountType: 'driver', status: 'active' });
    assignments.assign.mockResolvedValue({ ...activeAssignment, id: 'assignment-2', driverUserId: OTHER });

    await service.replaceDriver(TRIP, OTHER, { by: BOSS, reason: 'sick' });

    const recorded = notifications.record.mock.calls.map(([input]) => input);
    expect(recorded).toEqual([
      expect.objectContaining({ recipientUserId: DRIVER, type: 'TRIP_UNASSIGNED', eventKey: 'assignment:assignment-1:ended' }),
      expect.objectContaining({ recipientUserId: OTHER, type: 'TRIP_ASSIGNED', eventKey: 'assignment:assignment-2:assigned' }),
    ]);
    expect(notifications.deliver).toHaveBeenCalledTimes(1);
  });

  it('tells the driver taken off a trip', async () => {
    const { service, notifications } = build();

    await service.endAssignment(TRIP, { by: BOSS, reason: 'trip cancelled' });

    expect(notifications.record).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: DRIVER, type: 'TRIP_UNASSIGNED' }),
      TX,
    );
  });

  it('lists live driver accounts as id and name, nothing else', async () => {
    const { service } = build();
    await expect(service.listEligibleDrivers()).resolves.toEqual([{ id: DRIVER, displayName: 'Tài Xế' }]);
  });
});

describe('★ confirming a delivery is geofenced against the DELIVERY point', () => {
  const DELIVERY = { deliveryLatitude: 10.7769, deliveryLongitude: 106.7009 };
  const SENT_AT = new Date('2026-08-30T09:31:00Z');
  const atDelivery = {
    latitude: 10.7769,
    longitude: 106.7009,
    accuracyM: 8,
    capturedAt: new Date(SENT_AT.getTime() - 5_000),
  };

  const build = (over: Record<string, unknown> = {}) => {
    const trips = {
      lockActive: jest.fn().mockResolvedValue(
        openTrip({ pickupLatitude: 10.8188, pickupLongitude: 106.6564, ...DELIVERY, ...over }),
      ),
      exists: jest.fn(),
    };
    const assignments = { lockActive: jest.fn().mockResolvedValue(activeAssignment) };
    const events = {
      findByClientEventId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue({ id: 'event-4' }),
      listByTrip: jest.fn().mockResolvedValue([
        { type: 'ARRIVED_PICKUP' },
        { type: 'PICKUP_CONFIRMED' },
        { type: 'ARRIVED_DELIVERY' },
      ]),
    };
    const vehicles = { findById: jest.fn().mockResolvedValue({ id: VEHICLE, ownership: 'company' }) };
    const service = new TripExecutionService(
      database(),
      trips as never,
      assignments as never,
      events as never,
      vehicles as never,
      drivers() as never,
      told() as never,
    );
    return { service, events };
  };

  const delivering = {
    tripId: TRIP,
    type: 'DELIVERY_CONFIRMED' as const,
    deviceReportedAt: SENT_AT,
    clientEventId: 'tap-4',
    recordedBy: DRIVER,
  };

  it('passes at the delivery point and writes the verdict', async () => {
    const { service, events } = build();

    await service.recordEvent({ ...delivering, location: atDelivery });

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DELIVERY_CONFIRMED', geofencePassed: true, distanceM: 0 }),
      TX,
    );
  });

  it('★ refuses a reading at the PICKUP point — the two ends are different places', async () => {
    const { service, events } = build();
    const atPickup = { ...atDelivery, latitude: 10.8188, longitude: 106.6564 };

    const failure = await service
      .recordEvent({ ...delivering, location: atPickup })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ValidationError);
    expect((failure as ValidationError).details).toEqual({ location: 'OUTSIDE_GEOFENCE' });
    expect(events.record).not.toHaveBeenCalled();
  });

  it('refuses when the trip has no delivery coordinates yet', async () => {
    const { service } = build({ deliveryLatitude: null, deliveryLongitude: null });

    const failure = await service
      .recordEvent({ ...delivering, location: atDelivery })
      .catch((error: unknown) => error);

    expect((failure as ValidationError).details).toEqual({ location: 'DESTINATION_MISSING' });
  });

  it('refuses a delivery confirmation with no reading', async () => {
    const { service } = build();
    const failure = await service.recordEvent(delivering).catch((error: unknown) => error);
    expect((failure as ValidationError).details).toEqual({ location: 'LOCATION_REQUIRED' });
  });

  it('still refuses a delivery before the pickup was confirmed, before any location check', async () => {
    const { service, events } = build();
    events.listByTrip.mockResolvedValue([{ type: 'ARRIVED_PICKUP' }]);

    await expect(service.recordEvent({ ...delivering, location: atDelivery })).rejects.toThrow(
      ConflictError,
    );
  });

  it('does not geofence the arrival at delivery', async () => {
    const { service, events } = build();
    events.listByTrip.mockResolvedValue([{ type: 'ARRIVED_PICKUP' }, { type: 'PICKUP_CONFIRMED' }]);

    await service.recordEvent({ ...delivering, type: 'ARRIVED_DELIVERY', clientEventId: 'tap-3' });

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ARRIVED_DELIVERY', geofencePassed: null }),
      TX,
    );
  });
});

describe('★ a completion decision is told to the driver', () => {
  const build = () => {
    const trips = {
      lockActive: jest.fn().mockResolvedValue(openTrip()),
      updateStatus: jest.fn().mockResolvedValue(openTrip({ status: 'done' })),
      markClosed: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
    };
    const assignments = {
      lockActive: jest.fn().mockResolvedValue(activeAssignment),
      findActive: jest.fn().mockResolvedValue(activeAssignment),
    };
    const requests = {
      lockPending: jest.fn().mockResolvedValue({ id: 'request-1', state: 'pending', submittedBy: DRIVER }),
      submit: jest.fn(),
      decide: jest.fn().mockResolvedValue({ id: 'request-1', state: 'approved' }),
      listByTrip: jest.fn().mockResolvedValue([]),
    };
    const costs = {
      lockForTrip: jest.fn(),
      unlockForTrip: jest.fn().mockResolvedValue(1),
      finalizeForTrip: jest.fn().mockResolvedValue(1),
      listActiveByTrip: jest.fn().mockResolvedValue([]),
    };
    const history = { record: jest.fn().mockResolvedValue(undefined) };
    const notifications = told();
    const service = new TripCompletionService(
      database(),
      trips as never,
      assignments as never,
      requests as never,
      costs as never,
      history as never,
      notifications as never,
    );
    return { service, assignments, notifications };
  };

  it('★ carries the reason on a rejection, to the driver on the trip', async () => {
    const { service, notifications } = build();

    await service.reject(TRIP, { by: BOSS, reason: 'Thiếu hoá đơn dầu' });

    expect(notifications.record).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: DRIVER,
        type: 'COMPLETION_REJECTED',
        detail: 'Thiếu hoá đơn dầu',
        eventKey: 'completion:request-1:rejected',
      }),
      TX,
    );
    expect(notifications.deliver).toHaveBeenCalledTimes(1);
  });

  it('tells the driver the trip is closed on approval', async () => {
    const { service, notifications } = build();

    await service.approve(TRIP, BOSS);

    expect(notifications.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'COMPLETION_APPROVED', eventKey: 'completion:request-1:approved' }),
      TX,
    );
  });

  it('falls back to whoever submitted when nobody is on the trip any more', async () => {
    const { service, assignments, notifications } = build();
    assignments.findActive.mockResolvedValue(null);

    await service.approve(TRIP, BOSS);

    expect(notifications.record).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: DRIVER }),
      TX,
    );
  });

  it('delivers nothing when the decision is refused', async () => {
    const { service, assignments, notifications } = build();
    assignments.lockActive.mockResolvedValue(activeAssignment);
    (service as unknown as { requests: { lockPending: jest.Mock } }).requests.lockPending.mockResolvedValue(null);

    await expect(service.approve(TRIP, BOSS)).rejects.toThrow(ConflictError);
    expect(notifications.deliver).not.toHaveBeenCalled();
  });
});
