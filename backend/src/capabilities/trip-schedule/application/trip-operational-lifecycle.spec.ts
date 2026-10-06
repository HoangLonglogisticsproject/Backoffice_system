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
import { DispatchCrew } from './dispatch-crew';

/** No driver is asking for any of these bookings (0035): superseding finds nothing. */
const noAsks = () => ({ supersede: jest.fn().mockResolvedValue([]), deliver: jest.fn() });

/**
 * The one active global assignment — who a submitted completion is reported to
 * (0036). `null` is a deployment mid-handover, which some cases below pin.
 */
const reviewer = (userId: string | null = BOSS) => ({
  findActiveSuperAdmin: jest.fn().mockResolvedValue(userId === null ? null : { id: 'ra-1', userId }),
});

/**
 * The operational lifecycle, without a database.
 *
 * ★ WHAT THIS CAN AND CANNOT PROVE. It proves the ORDER and the CONDITIONS: that
 * approving freezes the money before it closes the trip, that a rejection
 * reopens it, that an edit writes its log in the same call, that a driver
 * cannot report somebody else's assignment, that one assignment's approval
 * does not close a trip another assignment is still on. It cannot prove that
 * PostgreSQL honours any of it — that two approvers really do serialise, that
 * `uq_trip_active_vehicle_assignment` really refuses the second insert. Those
 * need a real server and live in the integration specs.
 *
 * The fakes below are deliberately dumb: they record calls and return what they
 * are told to. A fake that reimplemented the SQL would be testing itself.
 */

const TRIP = 'trip-1';
const ASSIGNMENT = 'assignment-1';
const REQUEST = 'request-1';
const DRIVER = 'driver-1';
const OTHER = 'someone-else';
const BOSS = 'superadmin-1';
const VEHICLE = 'vehicle-1';
const SECOND_VEHICLE = 'vehicle-2';

/** Runs the callback with a sentinel executor, so a caller can assert it was passed. */
const TX = { query: jest.fn() } as unknown as DatabaseQuery;
const database = (): Database =>
  ({
    query: jest.fn(),
    transaction: jest.fn(async (work: (tx: DatabaseQuery) => Promise<unknown>) => work(TX)),
  }) as unknown as Database;

const openTrip = (over: Record<string, unknown> = {}) => ({
  id: TRIP,
  status: 'confirmed',
  // NOT NULL on every stored row; the pickup's day on the business calendar.
  scheduledOn: '2026-08-30',
  // ★ LEGACY, AND DELIBERATELY NOT THE ASSIGNMENT'S LORRY. Any snapshot that
  // reads this instead of the assignment fails the tests below.
  vehicleId: 'legacy-vehicle',
  pickupAt: new Date('2026-08-30T02:00:00Z'),
  deliveryAt: new Date('2026-08-30T09:00:00Z'),
  ...over,
});

const activeAssignment = {
  id: ASSIGNMENT,
  tripId: TRIP,
  vehicleId: VEHICLE,
  vehicle: { id: VEHICLE, plate: '50H49266' },
  driverUserId: DRIVER,
  state: 'active',
};

/** The four live readings of a complete execution — what a closable turn has. */
const FULL_JOURNEY = ['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED'].map(
  (type) => ({ id: `e-${type}`, type }),
);

const pendingRequest = (over: Record<string, unknown> = {}) => ({
  id: REQUEST,
  tripId: TRIP,
  driverAssignmentId: ASSIGNMENT,
  state: 'pending',
  submittedBy: DRIVER,
  ...over,
});

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
  /**
   * `over` replaces trip-repository behaviour; `reviewerUserId` is who holds
   * global authority while the case runs — `null` for none at all.
   */
  const build = (over: Record<string, unknown> = {}, reviewerUserId: string | null = BOSS) => {
    const trips = {
      lockActive: jest.fn().mockResolvedValue(openTrip()),
      updateStatus: jest.fn().mockResolvedValue(openTrip({ status: 'finished' })),
      markClosed: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      ...over,
    };
    const assignments = {
      findActiveById: jest.fn().mockResolvedValue(activeAssignment),
      lockActiveById: jest.fn().mockResolvedValue(activeAssignment),
    };
    const requests = {
      lockById: jest.fn().mockResolvedValue(null),
      lockPendingByAssignment: jest.fn().mockResolvedValue(null),
      submit: jest.fn().mockResolvedValue({ id: REQUEST, attemptNo: 1, state: 'pending' }),
      decide: jest.fn().mockResolvedValue({ id: REQUEST, state: 'approved' }),
      listByTrip: jest.fn().mockResolvedValue([]),
      listByAssignment: jest.fn().mockResolvedValue([]),
      // Nothing else outstanding: this assignment is the last one open.
      hasUnapprovedActiveAssignment: jest.fn().mockResolvedValue(false),
    };
    const costs = {
      lockForAssignment: jest.fn().mockResolvedValue(2),
      unlockForAssignment: jest.fn().mockResolvedValue(2),
      finalizeForAssignment: jest.fn().mockResolvedValue(2),
      // One live line, so the default declaration below is the consistent one.
      listActiveByAssignment: jest.fn().mockResolvedValue([{ id: 'cost-1' }]),
    };
    const history = { record: jest.fn().mockResolvedValue(undefined) };
    const notifications = told();
    // THIS assignment's live readings: a complete execution unless a case says otherwise.
    const events = { listByAssignment: jest.fn().mockResolvedValue(FULL_JOURNEY) };

    const roles = reviewer(reviewerUserId);

    const service = new TripCompletionService(
      database(),
      trips as never,
      assignments as never,
      requests as never,
      costs as never,
      history as never,
      notifications as never,
      events as never,
      noAsks() as never,
      roles as never,
    );

    return { service, trips, assignments, requests, costs, history, notifications, events, roles };
  };

  describe('submit', () => {
    it('freezes THIS assignment’s figures in the same call that records the request', async () => {
      // An approver reading a total that can still change is approving
      // something that no longer exists by the time they click — and driver
      // B's lorry on the same trip is none of this request's business.
      const { service, requests, costs } = build();

      await service.submit(ASSIGNMENT, DRIVER, 'expenses');

      expect(requests.submit).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: TRIP, driverAssignmentId: ASSIGNMENT }),
        TX,
      );
      expect(costs.lockForAssignment).toHaveBeenCalledWith(ASSIGNMENT, DRIVER, expect.any(Date), TX);
    });

    it('★ tells the reviewer, inside the transaction, keyed by the request (0036)', async () => {
      // Nobody watches the review queue all day. The row goes in beside the
      // request so a submit that rolls back tells nobody, and the key is the
      // request's so a retried submit rings once.
      const { service, notifications, roles } = build();

      await service.submit(ASSIGNMENT, DRIVER, 'expenses');

      expect(roles.findActiveSuperAdmin).toHaveBeenCalledWith(TX);
      expect(notifications.record).toHaveBeenCalledWith(
        {
          recipientUserId: BOSS,
          type: 'COMPLETION_SUBMITTED',
          tripId: TRIP,
          tripScheduledOn: '2026-08-30',
          eventKey: `completion:${REQUEST}:submitted`,
        },
        TX,
      );
      // Delivered after the commit, never from inside it.
      expect(notifications.deliver).toHaveBeenCalledWith([expect.objectContaining({ id: 'note' })]);
    });

    it('★ carries no figure and no reason to the reviewer — the queue holds those', async () => {
      const { service, notifications } = build();

      await service.submit(ASSIGNMENT, DRIVER, 'expenses');

      const [input] = notifications.record.mock.calls[0] as [Record<string, unknown>];
      expect(input).not.toHaveProperty('detail');
      expect(Object.keys(input)).not.toContain('expenseDeclaration');
    });

    it('still records the request when there is no active SuperAdmin to tell', async () => {
      // Mid-handover: revoke-then-grant in one transaction (0004) has a moment
      // with nobody global. The driver's turn must not fail for it, and the
      // queue shows the request regardless — it was never built on a notification.
      const { service, requests, notifications } = build({}, null);

      await service.submit(ASSIGNMENT, DRIVER, 'expenses');

      expect(requests.submit).toHaveBeenCalled();
      expect(notifications.record).not.toHaveBeenCalled();
      expect(notifications.deliver).toHaveBeenCalledWith([null]);
    });

    it('tells nobody when the submit is refused', async () => {
      const { service, requests, notifications } = build();
      requests.lockPendingByAssignment.mockResolvedValue(pendingRequest());

      await expect(service.submit(ASSIGNMENT, DRIVER, 'expenses')).rejects.toThrow(ConflictError);

      expect(notifications.record).not.toHaveBeenCalled();
      expect(notifications.deliver).not.toHaveBeenCalled();
    });

    it('refuses a second request while one is waiting on this assignment', async () => {
      const { service, requests } = build();
      requests.lockPendingByAssignment.mockResolvedValue(pendingRequest());

      await expect(service.submit(ASSIGNMENT, DRIVER, 'expenses')).rejects.toThrow(ConflictError);
    });

    it('refuses somebody who is not the driver on the assignment', async () => {
      const { service } = build();
      await expect(service.submit(ASSIGNMENT, OTHER, 'expenses')).rejects.toThrow(ConflictError);
    });

    it('refuses an assignment that has ended', async () => {
      const { service, assignments } = build();
      assignments.findActiveById.mockResolvedValue(null);

      await expect(service.submit(ASSIGNMENT, DRIVER, 'expenses')).rejects.toThrow(NotFoundError);
    });

    it('refuses a trip that is already closed', async () => {
      const { service, trips } = build();
      trips.lockActive.mockResolvedValue(openTrip({ status: 'finished' }));

      await expect(service.submit(ASSIGNMENT, DRIVER, 'expenses')).rejects.toThrow(ConflictError);
    });

    it.each([
      ['no milestone at all', []],
      ['only the arrival at pickup', FULL_JOURNEY.slice(0, 1)],
      ['up to the pickup confirmation', FULL_JOURNEY.slice(0, 2)],
      ['up to the arrival at delivery', FULL_JOURNEY.slice(0, 3)],
      ['a delivery confirmation whose arrival was withdrawn', FULL_JOURNEY.slice(1)],
    ])('★ refuses %s — 422 EXECUTION_INCOMPLETE, and writes nothing', async (_case, live) => {
      const { service, requests, costs, events } = build();
      events.listByAssignment.mockResolvedValue(live);

      await expect(service.submit(ASSIGNMENT, DRIVER, 'expenses')).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { execution: 'EXECUTION_INCOMPLETE' },
      });
      expect(events.listByAssignment).toHaveBeenCalledWith(ASSIGNMENT, false, TX);
      expect(requests.submit).not.toHaveBeenCalled();
      expect(costs.lockForAssignment).not.toHaveBeenCalled();
    });
  });

  describe('the expense declaration', () => {
    it('is stored as the driver stated it, on every attempt', async () => {
      const { service, requests, costs } = build();
      costs.listActiveByAssignment.mockResolvedValue([]);

      await service.submit(ASSIGNMENT, DRIVER, 'none');

      expect(requests.submit).toHaveBeenCalledWith(
        expect.objectContaining({ expenseDeclaration: 'none' }),
        TX,
      );
    });

    it('refuses "nothing to claim" when the assignment has expenses on it', async () => {
      // Both halves come from the same person, so a disagreement is a mistake —
      // and it would make DECLARED_NO_EXPENSE unreadable.
      const { service } = build();

      await expect(service.submit(ASSIGNMENT, DRIVER, 'none')).rejects.toThrow(ConflictError);
    });

    it('refuses "there were expenses" when none have been entered', async () => {
      const { service, costs } = build();
      costs.listActiveByAssignment.mockResolvedValue([]);

      await expect(service.submit(ASSIGNMENT, DRIVER, 'expenses')).rejects.toThrow(ConflictError);
    });

    it('counts only this assignment’s live lines', async () => {
      const { service, costs, requests } = build();
      costs.listActiveByAssignment.mockResolvedValue([]);

      await service.submit(ASSIGNMENT, DRIVER, 'none');

      expect(costs.listActiveByAssignment).toHaveBeenCalledWith(ASSIGNMENT, TX);
      expect(requests.submit).toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    const approving = () => {
      const built = build();
      built.requests.lockById.mockResolvedValue(pendingRequest());
      return built;
    };

    it('freezes the money BEFORE it closes the trip', async () => {
      // ★ THE ORDER IS THE ASSERTION. Reversed, there is an instant in which a
      // closed trip still carries an editable figure.
      const { service, costs, trips } = approving();
      const order: string[] = [];
      costs.finalizeForAssignment.mockImplementation(async () => {
        order.push('finalize');
        return 2;
      });
      trips.updateStatus.mockImplementation(async () => {
        order.push('close');
        return openTrip({ status: 'finished' });
      });

      await service.approve(TRIP, REQUEST, BOSS);

      expect(order).toEqual(['finalize', 'close']);
      expect(costs.finalizeForAssignment).toHaveBeenCalledWith(ASSIGNMENT, TX);
    });

    it('★ asks the execution again — a milestone withdrawn while the request waited refuses it, and nothing moves', async () => {
      const { service, requests, costs, trips, history, events } = approving();
      events.listByAssignment.mockResolvedValue(FULL_JOURNEY.filter((event) => event.type !== 'PICKUP_CONFIRMED'));

      await expect(service.approve(TRIP, REQUEST, BOSS)).rejects.toMatchObject({
        details: { execution: 'EXECUTION_INCOMPLETE' },
      });
      expect(events.listByAssignment).toHaveBeenCalledWith(ASSIGNMENT, false, TX);
      expect(requests.decide).not.toHaveBeenCalled();
      expect(costs.finalizeForAssignment).not.toHaveBeenCalled();
      expect(trips.updateStatus).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('★ finalizes only this assignment’s lines, never the trip’s', async () => {
      const { service, costs } = approving();

      await service.approve(TRIP, REQUEST, BOSS);

      expect(costs.finalizeForAssignment).toHaveBeenCalledTimes(1);
      expect(costs.finalizeForAssignment).toHaveBeenCalledWith(ASSIGNMENT, TX);
    });

    it('★ does NOT close the trip while another active assignment is unapproved', async () => {
      // Assignment A approved, assignment B still pending: A's money is final,
      // the trip is still open, and nothing about B moved.
      const { service, trips, history, requests, costs } = approving();
      requests.hasUnapprovedActiveAssignment.mockResolvedValue(true);

      await service.approve(TRIP, REQUEST, BOSS);

      expect(costs.finalizeForAssignment).toHaveBeenCalledWith(ASSIGNMENT, TX);
      expect(trips.updateStatus).not.toHaveBeenCalled();
      expect(trips.markClosed).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('★ closes the trip when the last active assignment is approved', async () => {
      const { service, trips, history, requests } = approving();
      requests.hasUnapprovedActiveAssignment.mockResolvedValue(false);

      await service.approve(TRIP, REQUEST, BOSS);

      expect(requests.hasUnapprovedActiveAssignment).toHaveBeenCalledWith(TRIP, TX);
      expect(trips.updateStatus).toHaveBeenCalledWith(TRIP, 'finished', TX);
      expect(history.record).toHaveBeenCalledTimes(1);
      expect(trips.markClosed).toHaveBeenCalledTimes(1);
    });

    it('records the move and stamps who closed it, in the same transaction', async () => {
      const { service, history, trips } = approving();
      trips.lockActive.mockResolvedValue(openTrip({ status: 'pending' }));

      await service.approve(TRIP, REQUEST, BOSS);

      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'pending', to: 'finished', changedBy: BOSS }),
        TX,
      );
      expect(trips.markClosed).toHaveBeenCalledWith(TRIP, BOSS, expect.any(Date), TX);
    });

    it('aborts the whole approval when freezing the money fails', async () => {
      // ★ WHAT THIS ACTUALLY PROVES, AND WHAT IT DOES NOT. It proves the service
      // stops: the trip is never marked done and never stamped. It does NOT
      // prove PostgreSQL rolls the transaction back — that needs a real server,
      // and that assertion lives in the integration spec.
      const { service, costs, trips, history } = approving();
      costs.finalizeForAssignment.mockRejectedValue(new Error('deadlock detected'));

      await expect(service.approve(TRIP, REQUEST, BOSS)).rejects.toThrow('deadlock detected');

      expect(trips.updateStatus).not.toHaveBeenCalled();
      expect(trips.markClosed).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('aborts before closing when the status write fails', async () => {
      const { service, trips, history } = approving();
      trips.updateStatus.mockRejectedValue(new Error('serialization failure'));

      await expect(service.approve(TRIP, REQUEST, BOSS)).rejects.toThrow('serialization failure');

      expect(history.record).not.toHaveBeenCalled();
      expect(trips.markClosed).not.toHaveBeenCalled();
    });

    it('refuses a request that does not exist', async () => {
      const { service } = build();
      await expect(service.approve(TRIP, REQUEST, BOSS)).rejects.toThrow(NotFoundError);
    });

    it('★ refuses a request that belongs to another trip, as if it did not exist', async () => {
      // A caller holding one trip's id must not reach another trip's review by
      // pairing it with a foreign request id.
      const { service, requests } = build();
      requests.lockById.mockResolvedValue(pendingRequest({ tripId: 'another-trip' }));

      await expect(service.approve(TRIP, REQUEST, BOSS)).rejects.toThrow(NotFoundError);
      expect(requests.decide).not.toHaveBeenCalled();
    });

    it('refuses a request that has already been decided', async () => {
      const { service, requests } = build();
      requests.lockById.mockResolvedValue(pendingRequest({ state: 'approved' }));

      await expect(service.approve(TRIP, REQUEST, BOSS)).rejects.toThrow(ConflictError);
      expect(requests.decide).not.toHaveBeenCalled();
    });

    it('turns a lost race into a conflict rather than overwriting the first decision', async () => {
      // The second approver's UPDATE carries `WHERE state = 'pending'` and gets
      // no row back. Anything other than a refusal here would silently rewrite
      // who approved the turn.
      const { service, requests } = approving();
      requests.decide.mockResolvedValue(null);

      await expect(service.approve(TRIP, REQUEST, BOSS)).rejects.toThrow(ConflictError);
    });
  });

  describe('reject', () => {
    const rejecting = () => {
      const built = build();
      built.requests.lockById.mockResolvedValue(pendingRequest());
      built.requests.decide.mockResolvedValue({ id: REQUEST, state: 'rejected' });
      return built;
    };

    it('reopens this assignment’s figures, because locking was only ever temporary', async () => {
      const { service, costs } = rejecting();

      await service.reject(TRIP, REQUEST, { by: BOSS, reason: 'Thiếu chứng từ dầu.' });

      expect(costs.unlockForAssignment).toHaveBeenCalledWith(ASSIGNMENT, TX);
      expect(costs.finalizeForAssignment).not.toHaveBeenCalled();
    });

    it('leaves the trip’s status alone', async () => {
      const { service, trips } = rejecting();

      await service.reject(TRIP, REQUEST, { by: BOSS, reason: 'Thiếu chứng từ dầu.' });

      expect(trips.updateStatus).not.toHaveBeenCalled();
      expect(trips.markClosed).not.toHaveBeenCalled();
    });

    it('refuses a rejection with no reason the driver can act on', async () => {
      const { service } = rejecting();
      await expect(service.reject(TRIP, REQUEST, { by: BOSS, reason: '   ' })).rejects.toThrow(
        ValidationError,
      );
    });

    it('passes the trimmed reason through to the decision', async () => {
      const { service, requests } = rejecting();

      await service.reject(TRIP, REQUEST, { by: BOSS, reason: '  Sai số tiền dầu.  ' });

      expect(requests.decide).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'rejected', reason: 'Sai số tiền dầu.' }),
        TX,
      );
    });
  });
});

describe('the one write path to DONE — and no office path through the lifecycle', () => {
  const build = () => {
    const trips = {
      lockActive: jest.fn().mockResolvedValue(openTrip()),
      create: jest.fn().mockResolvedValue(openTrip()),
      replace: jest.fn().mockResolvedValue(openTrip()),
      markClosed: jest.fn(),
      exists: jest.fn().mockResolvedValue(true),
    };
    const history = { record: jest.fn().mockResolvedValue(undefined) };
    const customers = { findById: jest.fn().mockResolvedValue({ id: 'customer-1', status: 'active' }) };

    const service = new TripScheduleService(
      database(),
      trips as never,
      customers as never,
      history as never,
      // No places on these trips: every case here types its ends by hand.
      { findById: jest.fn().mockResolvedValue(null) } as never,
      // No trip here is recorded after it ran, so no crew is written with one.
      { recordEnded: jest.fn() } as never,
      noAsks() as never,
    );

    return { service, trips, history };
  };
  const SET_BY_SERVER = { details: { status: 'STATUS_SET_BY_SERVER' } };

  it('refuses to move a trip to DONE from the general patch route', async () => {
    // `status` is a field of the patch body, which makes this the easy route to
    // forget. Completing a trip freezes its money, stamps who closed it and
    // writes the history — all in one transaction, in the completion service.
    const { service, trips } = build();

    await expect(service.update(TRIP, { status: 'finished' }, BOSS)).rejects.toThrow(ConflictError);
    expect(trips.replace).not.toHaveBeenCalled();
  });

  it('refuses to CREATE a trip that is already DONE', async () => {
    // ★ A single POST would otherwise produce a permanently closed trip with no
    // completion request, no approver and no frozen figures.
    const { service, trips } = build();

    await expect(
      service.create({ scheduledOn: '2026-08-30', status: 'finished', createdBy: BOSS }),
    ).rejects.toThrow(ConflictError);
    expect(trips.create).not.toHaveBeenCalled();
  });

  it('still refuses to reopen a completed trip', async () => {
    const { service, trips } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'finished' }));

    await expect(service.update(TRIP, { status: 'executing' }, BOSS)).rejects.toThrow(ConflictError);
    expect(trips.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', 'executing'],
    ['executing', 'pending'],
  ] as const)('★ an edit cannot move %s → %s — the lifecycle is the server’s, and nothing is written', async (from, to) => {
    const { service, trips, history } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: from }));

    await expect(service.update(TRIP, { status: to }, BOSS)).rejects.toMatchObject(SET_BY_SERVER);
    await expect(service.update(TRIP, { status: to }, BOSS)).rejects.toThrow(ValidationError);
    expect(trips.replace).not.toHaveBeenCalled();
    expect(history.record).not.toHaveBeenCalled();
  });

  it('★ an edit naming the status the trip already holds is a no-op — saved, nothing moved', async () => {
    // Lịch sử chuyến's correction re-sends its frozen `finished`; a client from
    // before this rule re-sends what it read.
    const { service, trips, history } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'executing' }));
    trips.replace.mockResolvedValue(openTrip({ status: 'executing', note: 'Đổi giờ' }));

    await service.update(TRIP, { status: 'executing', note: 'Đổi giờ' }, BOSS);

    expect(trips.replace).toHaveBeenCalledWith(TRIP, expect.objectContaining({ status: 'executing' }), TX);
    expect(history.record).not.toHaveBeenCalled();
  });

  it('★ a booking cannot choose its lifecycle: `executing` is refused, `pending` is the no-op it always was', async () => {
    const { service, trips } = build();

    await expect(
      service.create({ scheduledOn: '2026-08-30', status: 'executing', createdBy: BOSS }),
    ).rejects.toMatchObject(SET_BY_SERVER);
    expect(trips.create).not.toHaveBeenCalled();

    await service.create({ scheduledOn: '2026-08-30', status: 'pending', createdBy: BOSS });
    await service.create({ scheduledOn: '2026-08-30', createdBy: BOSS });
    expect(trips.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'pending' }), TX);
    expect(trips.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'pending' }), TX);
  });

  it('records the opening status when a trip is created', async () => {
    const { service, history } = build();

    await service.create({ scheduledOn: '2026-08-30', createdBy: BOSS });

    expect(history.record).toHaveBeenCalledWith(
      expect.objectContaining({ from: null, changedBy: BOSS }),
      TX,
    );
  });

  it('★ writes no lorry onto the trip row — dispatch is an assignment, not a column', async () => {
    // ADR-0004: `trip_schedules.vehicle_id` is legacy. A create body cannot
    // name a lorry, and the row written carries none.
    const { service, trips } = build();

    await service.create({ scheduledOn: '2026-08-30', createdBy: BOSS });

    const written = trips.create.mock.calls[0][0] as Record<string, unknown>;
    expect('vehicleId' in written).toBe(false);
  });
});

describe('expense accountability, as a read model', () => {
  const request = (over: Record<string, unknown> = {}) =>
    ({
      id: REQUEST,
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
    const trips = {
      lockActive: jest.fn().mockResolvedValue(openTrip()),
      exists: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(openTrip({ status: 'executing' })),
    };
    const history = { record: jest.fn().mockResolvedValue(undefined) };
    const assignments = {
      findActiveById: jest.fn().mockResolvedValue(activeAssignment),
      lockActiveById: jest.fn().mockResolvedValue(activeAssignment),
    };
    const events = {
      findByClientEventId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue({ id: 'event-1' }),
      // The journey so far ON THIS ASSIGNMENT. Empty means nothing reported
      // yet, so only ARRIVED_PICKUP is admissible — the ordering rule reads this.
      listByAssignment: jest.fn().mockResolvedValue([]),
      hasLiveEvents: jest.fn().mockResolvedValue(false),
      void: jest.fn(),
      ...over,
    };
    const vehicles = {
      findById: jest.fn().mockResolvedValue({ id: VEHICLE, ownership: 'company' }),
      findForShare: jest.fn().mockResolvedValue({ id: VEHICLE, ownership: 'company' }),
    };
    const users = drivers();
    const notifications = told();
    const requests = { listByAssignment: jest.fn().mockResolvedValue([]) };

    const service = new TripExecutionService(
      database(),
      trips as never,
      assignments as never,
      events as never,
      vehicles as never,
      users as never,
      notifications as never,
      requests as never,
      history as never,
      { exists: jest.fn().mockResolvedValue(false) } as never,
      new DispatchCrew(assignments as never, vehicles as never, users as never, notifications as never, noAsks() as never),
    );

    return { service, trips, assignments, events, vehicles, users, notifications, requests, history };
  };

  const arriving = {
    assignmentId: ASSIGNMENT,
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
      expect.objectContaining({ tripId: TRIP, scheduledAt: new Date('2026-08-30T02:00:00Z') }),
      TX,
    );
  });

  it('snapshots the DELIVERY time for a delivery event', async () => {
    const { service, events } = build();
    // The two pickup milestones already stand, so a delivery arrival is
    // admissible — see the ordering rule.
    events.listByAssignment.mockResolvedValue([
      { type: 'ARRIVED_PICKUP' },
      { type: 'PICKUP_CONFIRMED' },
    ]);

    await service.recordEvent({ ...arriving, type: 'ARRIVED_DELIVERY', clientEventId: 'tap-2' });

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: new Date('2026-08-30T09:00:00Z') }),
      TX,
    );
  });

  it('★ copies the ASSIGNMENT’s lorry and its ownership beside the event — never the trip’s', async () => {
    // The trip row still carries a legacy `vehicleId`; it is not what this
    // driver is driving.
    const { service, events, vehicles } = build();

    await service.recordEvent(arriving);

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: VEHICLE, vehicleOwnership: 'company' }),
      TX,
    );
    // Read under the turn's locks, FOR SHARE — the same row the fuel gate reads.
    expect(vehicles.findForShare).toHaveBeenCalledWith(VEHICLE, TX);
  });

  it('records an unclassified lorry as null, never as company', async () => {
    // ★ 0013 leaves every existing lorry unclassified on purpose. Substituting
    // a value here would be the system asserting a fact nobody stated.
    const { service, events, vehicles } = build();
    vehicles.findForShare.mockResolvedValue({ id: VEHICLE, ownership: null });

    await service.recordEvent(arriving);

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleOwnership: null }),
      TX,
    );
  });

  it('★ judges the sequence against THIS assignment’s events, not the trip’s', async () => {
    const { service, events } = build();

    await service.recordEvent(arriving);

    expect(events.listByAssignment).toHaveBeenCalledWith(ASSIGNMENT, false, TX);
  });

  it('★ the first live milestone on a PENDING trip puts it on the road — status and history, in the same transaction', async () => {
    // The driver starts execution; nothing in the office does.
    const { service, trips, history } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'pending' }));

    await service.recordEvent(arriving);

    expect(trips.updateStatus).toHaveBeenCalledWith(TRIP, 'executing', TX);
    expect(history.record).toHaveBeenCalledWith(
      { tripId: TRIP, from: 'pending', to: 'executing', reason: 'execution_started', changedBy: DRIVER },
      TX,
    );
  });

  it.each(['executing', 'confirmed'])('moves nothing on a trip already %s', async (status) => {
    // Already on the road; or the retired `confirmed`, which meant done.
    const { service, trips, history } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status }));

    await service.recordEvent(arriving);

    expect(trips.updateStatus).not.toHaveBeenCalled();
    expect(history.record).not.toHaveBeenCalled();
  });

  it('★ moves nothing for a retry, or for a report it refuses', async () => {
    const { service, trips, events, history } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'pending' }));

    // A retry is answered with the row it repeats — no new event, no move.
    events.findByClientEventId.mockResolvedValueOnce({ id: 'event-1', type: 'ARRIVED_PICKUP', driverAssignmentId: ASSIGNMENT });
    await service.recordEvent(arriving);
    // A report out of order is refused before anything is written.
    await expect(
      service.recordEvent({ ...arriving, type: 'ARRIVED_DELIVERY', clientEventId: 'tap-9' }),
    ).rejects.toThrow(ConflictError);

    expect(trips.updateStatus).not.toHaveBeenCalled();
    expect(history.record).not.toHaveBeenCalled();
  });

  it('answers a retry with the event it already wrote', async () => {
    // A driver on a bad connection did nothing wrong; the honest answer to
    // "record this arrival" that is already recorded is the arrival.
    const { service, events } = build();
    events.findByClientEventId.mockResolvedValue({ id: 'event-1', type: 'ARRIVED_PICKUP', driverAssignmentId: ASSIGNMENT });

    const result = await service.recordEvent(arriving);

    expect(result).toEqual({ id: 'event-1', type: 'ARRIVED_PICKUP', driverAssignmentId: ASSIGNMENT });
    expect(events.record).not.toHaveBeenCalled();
  });

  it('★ refuses a client event id first used on ANOTHER assignment of the trip — never answers with that turn’s event', async () => {
    const { service, events } = build();
    events.findByClientEventId.mockResolvedValue({ id: 'event-9', type: 'ARRIVED_PICKUP', driverAssignmentId: 'assignment-2' });

    await expect(service.recordEvent(arriving)).rejects.toThrow(ConflictError);
    await expect(service.recordEvent(arriving)).rejects.toThrow(/another assignment/);
    expect(events.record).not.toHaveBeenCalled();
  });

  /**
   * ★ AN APPROVED TURN'S RECORD IS FINAL (DL-108). Per assignment, under the
   * trip lock, after the idempotency answer — so a sibling turn still pending
   * does not reopen it, and a retry of a milestone reported before the
   * approval still gets its row.
   */
  describe('★ once the turn is approved', () => {
    it('refuses a new milestone, and writes nothing', async () => {
      const { service, events, requests } = build();
      requests.listByAssignment.mockResolvedValue([{ state: 'approved', attemptNo: 1 }]);

      await expect(service.recordEvent(arriving)).rejects.toThrow(ConflictError);
      expect(events.record).not.toHaveBeenCalled();
    });

    it('refuses it whatever earlier attempts the turn had — an approval wins over a rejection before it', async () => {
      const { service, events, requests } = build();
      requests.listByAssignment.mockResolvedValue([
        { state: 'approved', attemptNo: 2 },
        { state: 'rejected', attemptNo: 1 },
      ]);

      await expect(service.recordEvent(arriving)).rejects.toThrow(ConflictError);
      expect(events.record).not.toHaveBeenCalled();
    });

    it('★ still answers a retry of a milestone reported BEFORE the approval with that row', async () => {
      const { service, events, requests } = build();
      const stored = { id: 'event-1', driverAssignmentId: ASSIGNMENT, type: 'ARRIVED_PICKUP' };
      events.findByClientEventId.mockResolvedValue(stored);
      requests.listByAssignment.mockResolvedValue([{ state: 'approved', attemptNo: 1 }]);

      await expect(service.recordEvent(arriving)).resolves.toEqual(stored);
      expect(events.record).not.toHaveBeenCalled();
      // The approval was never consulted: the answer came from the key.
      expect(requests.listByAssignment).not.toHaveBeenCalled();
    });

    it('lets a PENDING turn keep reporting — a milestone withdrawn during review is reported again', async () => {
      // Submitting needs every milestone live, but a reading can be withdrawn
      // while the request waits; the driver reports it again, and the approval
      // asks the execution afresh.
      const { service, events, requests } = build();
      requests.listByAssignment.mockResolvedValue([{ state: 'pending', attemptNo: 1 }]);

      await service.recordEvent(arriving);

      expect(events.record).toHaveBeenCalled();
    });

    it('lets a REJECTED turn keep reporting — that is what a rejection asks for', async () => {
      const { service, events, requests } = build();
      requests.listByAssignment.mockResolvedValue([{ state: 'rejected', attemptNo: 1 }]);

      await service.recordEvent(arriving);

      expect(events.record).toHaveBeenCalled();
    });

    it('lets a turn with no request at all report, as before', async () => {
      const { service, events, requests } = build();
      requests.listByAssignment.mockResolvedValue([]);

      await service.recordEvent(arriving);

      expect(events.record).toHaveBeenCalled();
    });
  });

  it('refuses to let one driver report another driver’s assignment', async () => {
    const { service } = build();
    await expect(service.recordEvent({ ...arriving, recordedBy: OTHER })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('refuses an assignment that does not exist or has ended', async () => {
    const { service, assignments } = build();
    assignments.findActiveById.mockResolvedValue(null);

    await expect(service.recordEvent(arriving)).rejects.toThrow(NotFoundError);
  });

  it('refuses an assignment that ended between the read and the lock', async () => {
    const { service, assignments } = build();
    assignments.lockActiveById.mockResolvedValue(null);

    await expect(service.recordEvent(arriving)).rejects.toThrow(ConflictError);
  });

  it('refuses a pre-multi-vehicle assignment that names no lorry', async () => {
    const { service, assignments, events } = build();
    assignments.lockActiveById.mockResolvedValue({ ...activeAssignment, vehicleId: null, vehicle: null });

    await expect(service.recordEvent(arriving)).rejects.toThrow(ConflictError);
    expect(events.record).not.toHaveBeenCalled();
  });

  it('refuses a closed trip', async () => {
    const { service, trips } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'finished' }));

    await expect(service.recordEvent(arriving)).rejects.toThrow(ConflictError);
  });

  it('refuses a blank client event id, which would defeat retry protection', async () => {
    const { service } = build();
    await expect(service.recordEvent({ ...arriving, clientEventId: '  ' })).rejects.toThrow(
      ValidationError,
    );
  });

  /**
   * ★ CONFIRMING A PICKUP IS A BUTTON, AND NOT A POSITION.
   *
   * `GEOFENCED_MILESTONES` is empty, so the service asks the geofence about
   * nothing: a confirmation needs no reading, needs no coordinates on the trip,
   * and reaches no verdict. The driver's tap IS the milestone.
   *
   * ★ WHAT IS PINNED HERE IS THAT THE CHECK IS OFF, NOT THAT IT IS GONE. The
   * rule itself — radius, accuracy ceiling, freshness window, distance — is
   * still whole and still tested in `trip-location.spec.ts`, for the day the
   * list is filled in again (contract §11 [FUTURE]). What a reading sent anyway
   * gets is storage, never a verdict: nothing measured it.
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
        listByAssignment: jest.fn().mockResolvedValue([{ type: 'ARRIVED_PICKUP' }]),
      });
      built.trips.lockActive.mockResolvedValue(openTrip({ ...PICKUP, ...over }));
      return built;
    };

    const confirming = {
      assignmentId: ASSIGNMENT,
      type: 'PICKUP_CONFIRMED' as const,
      deviceReportedAt: SENT_AT,
      clientEventId: 'tap-2',
      recordedBy: DRIVER,
    };

    it('★ records the confirmation from the tap alone — no reading, no verdict', async () => {
      const { service, events } = located();

      await service.recordEvent(confirming);

      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PICKUP_CONFIRMED',
          location: null,
          geofencePassed: null,
          distanceM: null,
        }),
        TX,
      );
    });

    it('★ records it even when the trip has no coordinates (GAP-14 no longer blocks a driver)', async () => {
      // The warehouse coordinates Operations has still to collect used to make
      // this confirmation impossible. Nothing measures against them now, so
      // their absence is not the driver's problem.
      const { service, events } = located({ pickupLatitude: null, pickupLongitude: null });

      await service.recordEvent(confirming);

      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PICKUP_CONFIRMED', geofencePassed: null }),
        TX,
      );
    });

    it('★ keeps a reading sent anyway as evidence, and still reaches no verdict on it', async () => {
      const { service, events } = located();

      await service.recordEvent({ ...confirming, location: goodFix });

      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ location: goodFix, geofencePassed: null, distanceM: null }),
        TX,
      );
    });

    it('★ accepts a reading from the wrong side of town — nothing is measuring it', async () => {
      // ~1.1 km north of the pickup. A refusal here would mean the check is on.
      const { service, events } = located();
      const far = { ...goodFix, latitude: goodFix.latitude + 0.01 };

      await service.recordEvent({ ...confirming, location: far });

      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ location: far, geofencePassed: null }),
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

    it('★ keeps an old fix too, since no freshness window applies to it any more', async () => {
      const { service, events } = located();
      const old = { ...goodFix, capturedAt: new Date(SENT_AT.getTime() - 10 * 60_000) };

      await service.recordEvent({ ...confirming, location: old });

      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ location: old, geofencePassed: null }),
        TX,
      );
    });

    it('answers a retry with the event already written', async () => {
      // A retry after a timeout carries no new reading and must not need one:
      // the pickup already happened.
      const { service, events } = located();
      events.findByClientEventId.mockResolvedValue({ id: 'event-2', type: 'PICKUP_CONFIRMED', driverAssignmentId: ASSIGNMENT });

      const result = await service.recordEvent(confirming);

      expect(result).toEqual({ id: 'event-2', type: 'PICKUP_CONFIRMED', driverAssignmentId: ASSIGNMENT });
      expect(events.record).not.toHaveBeenCalled();
    });

    it('still checks ownership, so the refusal is the right one', async () => {
      const { service, assignments } = located();
      assignments.lockActiveById.mockResolvedValue({ ...activeAssignment, driverUserId: OTHER });

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

describe('dispatch assignment', () => {
  const build = () => {
    const trips = { lockActive: jest.fn().mockResolvedValue(openTrip()), exists: jest.fn() };
    const users = drivers();
    const notifications = told();
    const assignments = {
      // The lorry is free on this trip unless a case says otherwise.
      lockActiveByVehicle: jest.fn().mockResolvedValue(null),
      lockActiveById: jest.fn().mockResolvedValue(activeAssignment),
      assign: jest.fn().mockResolvedValue({ ...activeAssignment, id: 'assignment-2', driverUserId: OTHER }),
      end: jest.fn().mockResolvedValue({ ...activeAssignment, state: 'ended' }),
    };
    const events = {
      findByClientEventId: jest.fn(),
      // Not started unless a case says otherwise.
      hasLiveEvents: jest.fn().mockResolvedValue(false),
    };
    const vehicles = {
      findById: jest.fn().mockResolvedValue({ id: VEHICLE, status: 'active' }),
      findForShare: jest.fn().mockResolvedValue({ id: VEHICLE, status: 'active' }),
    };
    const requests = { listByAssignment: jest.fn().mockResolvedValue([]) };
    const service = new TripExecutionService(
      database(),
      trips as never,
      assignments as never,
      events as never,
      vehicles as never,
      users as never,
      notifications as never,
      requests as never,
      { record: jest.fn() } as never,
      { exists: jest.fn().mockResolvedValue(false) } as never,
      new DispatchCrew(assignments as never, vehicles as never, users as never, notifications as never, noAsks() as never),
    );
    return { service, trips, assignments, events, vehicles, users, notifications, requests };
  };

  const pair = { vehicleId: VEHICLE, driverUserId: DRIVER };

  it('★ refuses the same lorry twice on one trip, rather than silently adding a second turn', async () => {
    const { service, assignments } = build();
    assignments.lockActiveByVehicle.mockResolvedValue(activeAssignment);

    await expect(service.assign(TRIP, pair, BOSS)).rejects.toThrow(ConflictError);
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('★ accepts the same driver on a second lorry of the same trip', async () => {
    // One person, two lorries, two turns — a confirmed business case.
    const { service, assignments } = build();

    await service.assign(TRIP, { vehicleId: SECOND_VEHICLE, driverUserId: DRIVER }, BOSS);

    expect(assignments.assign).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: TRIP, vehicleId: SECOND_VEHICLE, driverUserId: DRIVER }),
      TX,
    );
  });

  it('refuses a lorry retired from the catalogue', async () => {
    const { service, vehicles, assignments } = build();
    vehicles.findById.mockResolvedValue({ id: VEHICLE, status: 'archived' });

    await expect(service.assign(TRIP, pair, BOSS)).rejects.toThrow(ConflictError);
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('ends the previous turn before starting the new one on the SAME lorry, never overwriting it', async () => {
    // ★ Overwriting `driver_user_id` would destroy the answer to "who was
    // on this lorry when this expense was recorded".
    const { service, assignments } = build();
    const order: string[] = [];
    assignments.end.mockImplementation(async () => {
      order.push('end');
      return { ...activeAssignment, state: 'ended' };
    });
    assignments.assign.mockImplementation(async () => {
      order.push('assign');
      return { ...activeAssignment, id: 'assignment-2', driverUserId: OTHER };
    });

    await service.replaceDriver(TRIP, ASSIGNMENT, OTHER, { by: BOSS, reason: 'Tài xế báo ốm.' });

    expect(order).toEqual(['end', 'assign']);
    expect(assignments.end).toHaveBeenCalledWith(
      expect.objectContaining({ id: ASSIGNMENT, reason: 'Tài xế báo ốm.' }),
      TX,
    );
    expect(assignments.assign).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: VEHICLE, driverUserId: OTHER }),
      TX,
    );
  });

  it('refuses a driver change with no reason', async () => {
    const { service } = build();
    await expect(
      service.replaceDriver(TRIP, ASSIGNMENT, OTHER, { by: BOSS, reason: '' }),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses to replace a driver with the same driver', async () => {
    const { service } = build();

    await expect(
      service.replaceDriver(TRIP, ASSIGNMENT, DRIVER, { by: BOSS, reason: 'Nhầm.' }),
    ).rejects.toThrow(ConflictError);
  });

  it('★ refuses to replace the driver once the turn has started executing', async () => {
    // ADR-0004: after the first milestone the pair is what happened. No
    // takeover, no inherited timeline.
    const { service, events, assignments } = build();
    events.hasLiveEvents.mockResolvedValue(true);

    await expect(
      service.replaceDriver(TRIP, ASSIGNMENT, OTHER, { by: BOSS, reason: 'Đổi người.' }),
    ).rejects.toThrow(ConflictError);
    expect(assignments.end).not.toHaveBeenCalled();
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('★ refuses to end a turn once it has started executing', async () => {
    const { service, events, assignments } = build();
    events.hasLiveEvents.mockResolvedValue(true);

    await expect(
      service.endAssignment(TRIP, ASSIGNMENT, { by: BOSS, reason: 'Huỷ xe.' }),
    ).rejects.toThrow(ConflictError);
    expect(assignments.end).not.toHaveBeenCalled();
  });

  it('ends a turn that has not started, with the reason', async () => {
    const { service, assignments } = build();

    await service.endAssignment(TRIP, ASSIGNMENT, { by: BOSS, reason: 'Huỷ xe.' });

    expect(assignments.end).toHaveBeenCalledWith(
      expect.objectContaining({ id: ASSIGNMENT, endedBy: BOSS, reason: 'Huỷ xe.' }),
      TX,
    );
  });

  it('★ refuses an assignment that belongs to another trip, as if it did not exist', async () => {
    const { service, assignments } = build();
    assignments.lockActiveById.mockResolvedValue({ ...activeAssignment, tripId: 'another-trip' });

    await expect(
      service.endAssignment(TRIP, ASSIGNMENT, { by: BOSS, reason: 'Huỷ xe.' }),
    ).rejects.toThrow(NotFoundError);
    expect(assignments.end).not.toHaveBeenCalled();
  });

  it('refuses to end a turn that has already ended', async () => {
    const { service, assignments } = build();
    assignments.lockActiveById.mockResolvedValue(null);

    await expect(
      service.endAssignment(TRIP, ASSIGNMENT, { by: BOSS, reason: 'Huỷ xe.' }),
    ).rejects.toThrow(NotFoundError);
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
    // ANY state: the money routes read a turn recorded after the run too.
    const assignments = {
      findById: jest.fn().mockResolvedValue(activeAssignment),
      lockById: jest.fn().mockResolvedValue(activeAssignment),
    };
    const vehicles = {
      findById: jest.fn().mockResolvedValue({ id: VEHICLE, ownership: 'company' }),
      findForShare: jest.fn().mockResolvedValue({ id: VEHICLE, ownership: 'company' }),
    };
    // No completion request on the turn yet — the ordinary, declarable state.
    const requests = { listByAssignment: jest.fn().mockResolvedValue([]) };

    const service = new TripCostService(
      database(),
      trips as never,
      costs as never,
      {} as never,
      {} as never,
      assignments as never,
      vehicles as never,
      requests as never,
    );

    return { service, trips, costs, assignments, vehicles, requests };
  };

  const declaring = {
    assignmentId: ASSIGNMENT,
    category: 'fuel' as const,
    amount: '1500000.00',
    declaredBy: DRIVER,
  };

  it('★ writes the assignment and ITS lorry’s snapshots alongside the figure — never the trip’s', async () => {
    const { service, costs, vehicles } = build();

    await service.declareCost(declaring);

    expect(costs.declare).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: TRIP,
        driverAssignmentId: ASSIGNMENT,
        vehicleId: VEHICLE,
        vehicleOwnership: 'company',
      }),
      TX,
    );
    expect(vehicles.findById).toHaveBeenCalledWith(VEHICLE, TX);
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

  it('refuses a pre-multi-vehicle assignment with no lorry — there is nothing to spend on', async () => {
    const { service, assignments } = build();
    assignments.lockById.mockResolvedValue({ ...activeAssignment, vehicleId: null, vehicle: null });

    await expect(service.declareCost(declaring)).rejects.toThrow(ConflictError);
  });

  it('refuses somebody who is not the driver on the assignment', async () => {
    const { service } = build();
    await expect(service.declareCost({ ...declaring, declaredBy: OTHER })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('refuses an assignment that does not exist', async () => {
    const { service, assignments } = build();
    assignments.findById.mockResolvedValue(null);

    await expect(service.declareCost(declaring)).rejects.toThrow(NotFoundError);
  });

  it('refuses a turn that was replaced or removed — it carries no money any more', async () => {
    const { service, assignments, costs } = build();
    assignments.lockById.mockResolvedValue({ ...activeAssignment, state: 'ended', endReason: 'xe hỏng' });

    // As reporting and completion answer it: as a turn that does not exist.
    await expect(service.declareCost(declaring)).rejects.toThrow(NotFoundError);
    expect(costs.declare).not.toHaveBeenCalled();
  });

  it('★ keeps a normal finished trip read-only: an active turn on a closed trip takes no new line', async () => {
    const { service, trips, costs } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'finished' }));

    await expect(service.declareCost(declaring)).rejects.toThrow('That trip is closed.');
    expect(costs.declare).not.toHaveBeenCalled();
  });

  it('★ lets the driver of a turn RECORDED after the run add what it cost — the one closed turn that takes money', async () => {
    const { service, trips, assignments, costs } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'finished' }));
    assignments.lockById.mockResolvedValue({ ...activeAssignment, state: 'ended', endReason: 'historical_entry' });

    await service.declareCost(declaring);

    expect(costs.declare).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: TRIP, driverAssignmentId: ASSIGNMENT, createdBy: DRIVER }),
      TX,
    );
  });

  it('★ refuses an archived trip, recorded turn or not — `lockActive` finds no row', async () => {
    const { service, trips, assignments, costs } = build();
    trips.lockActive.mockResolvedValue(null);
    assignments.lockById.mockResolvedValue({ ...activeAssignment, state: 'ended', endReason: 'historical_entry' });

    await expect(service.declareCost(declaring)).rejects.toThrow(NotFoundError);
    expect(costs.declare).not.toHaveBeenCalled();
  });

  /**
   * ★ THE EXPENSE-VS-COMPLETION RACE, CLOSED AT THE SERVICE.
   *
   * `submit` freezes the lines that exist and `approve` finalises them; a line
   * declared after either would be one the reviewer never saw, or money moving
   * on a closed turn. The UPDATE trigger cannot see an INSERT, so the refusal
   * is here — under the same trip lock the two decisions take.
   */
  it('★ refuses a new line while a completion request is pending', async () => {
    const { service, costs, requests } = build();
    requests.listByAssignment.mockResolvedValue([{ state: 'pending', attemptNo: 1 }]);

    await expect(service.declareCost(declaring)).rejects.toThrow(ConflictError);
    expect(costs.declare).not.toHaveBeenCalled();
  });

  it('★ refuses a new line once the turn is approved, whatever came before', async () => {
    const { service, costs, requests } = build();
    requests.listByAssignment.mockResolvedValue([
      { state: 'approved', attemptNo: 2 },
      { state: 'rejected', attemptNo: 1 },
    ]);

    await expect(service.declareCost(declaring)).rejects.toThrow(ConflictError);
    expect(costs.declare).not.toHaveBeenCalled();
  });

  it('accepts a new line after a rejection — the turn is the driver’s to correct again', async () => {
    const { service, costs, requests } = build();
    requests.listByAssignment.mockResolvedValue([{ state: 'rejected', attemptNo: 1 }]);

    await service.declareCost(declaring);

    expect(costs.declare).toHaveBeenCalled();
  });

  it('★ still answers a retry with the original line after the request went pending', async () => {
    // The phone declared before the submit and is retrying after it: the
    // honest answer is the line it already wrote, not a refusal.
    const { service, costs, requests } = build();
    costs.findByClientRequestId.mockResolvedValue({ id: 'cost-1', amount: '1500000.00', driverAssignmentId: ASSIGNMENT });
    requests.listByAssignment.mockResolvedValue([{ state: 'pending', attemptNo: 1 }]);

    const result = await service.declareCost({ ...declaring, clientRequestId: 'tap-1' });

    expect(result).toEqual({ id: 'cost-1', amount: '1500000.00', driverAssignmentId: ASSIGNMENT });
    expect(costs.declare).not.toHaveBeenCalled();
  });

  it('answers a retry with the line it already wrote', async () => {
    const { service, costs } = build();
    costs.findByClientRequestId.mockResolvedValue({ id: 'cost-1', amount: '1500000.00', driverAssignmentId: ASSIGNMENT });

    const result = await service.declareCost({ ...declaring, clientRequestId: 'tap-1' });

    expect(result).toEqual({ id: 'cost-1', amount: '1500000.00', driverAssignmentId: ASSIGNMENT });
    // Third argument is the executor: `undefined` is the UNLOCKED read, which
    // is the one that answers an ordinary retry without opening a transaction.
    // The locked repeat under the trip row is exercised by the integration
    // spec, where two of these can actually arrive together.
    expect(costs.findByClientRequestId).toHaveBeenCalledWith(TRIP, 'tap-1', undefined);
    expect(costs.declare).not.toHaveBeenCalled();
  });

  it('★ refuses a client request id first used on ANOTHER assignment of the trip — never answers with that turn’s line', async () => {
    const { service, costs } = build();
    costs.findByClientRequestId.mockResolvedValue({ id: 'cost-9', amount: '1.00', driverAssignmentId: 'assignment-2' });

    await expect(service.declareCost({ ...declaring, clientRequestId: 'tap-1' })).rejects.toThrow(ConflictError);
    expect(costs.declare).not.toHaveBeenCalled();
  });
});

describe('correcting a declared expense', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: 'cost-1',
    tripId: TRIP,
    driverAssignmentId: ASSIGNMENT,
    category: 'fuel',
    amount: '1500000.00',
    note: null,
    state: 'editable',
    source: 'driver_portal',
    createdBy: DRIVER,
    voidedAt: null,
    ...over,
  });

  const build = (
    current: Record<string, unknown>,
    tripStatus: string | null = 'executing',
    turn: Record<string, unknown> = activeAssignment,
  ) => {
    const costs = {
      lockById: jest.fn().mockResolvedValue(current),
      editEditable: jest.fn().mockResolvedValue({ ...current, amount: '1550000.00' }),
      recordEdits: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TripCostService(
      database(),
      {
        exists: jest.fn(),
        // `null` is what `lockActive` answers for an archived trip.
        lockActive: jest.fn().mockResolvedValue(tripStatus === null ? null : { id: TRIP, status: tripStatus }),
      } as never,
      costs as never,
      {} as never,
      {} as never,
      {
        findById: jest.fn().mockResolvedValue({ id: ASSIGNMENT, tripId: TRIP }),
        lockById: jest.fn().mockResolvedValue(turn),
      } as never,
      {} as never,
      {} as never,
    );
    return { service, costs };
  };

  it('★ lets the driver correct a line on a turn RECORDED after the run', async () => {
    const recorded = { ...activeAssignment, state: 'ended', endReason: 'historical_entry' };
    const { service, costs } = build(line(), 'finished', recorded);

    await service.editCost(ASSIGNMENT, 'cost-1', { amount: '1550000.00' }, DRIVER);

    expect(costs.editEditable).toHaveBeenCalled();
  });

  it('★ refuses a correction once the recorded trip is archived', async () => {
    const recorded = { ...activeAssignment, state: 'ended', endReason: 'historical_entry' };
    const { service, costs } = build(line(), null, recorded);

    await expect(service.editCost(ASSIGNMENT, 'cost-1', { amount: '1550000.00' }, DRIVER)).rejects.toThrow(
      NotFoundError,
    );
    expect(costs.editEditable).not.toHaveBeenCalled();
  });

  it('★ refuses any correction once the trip is closed — even of a line still editable', async () => {
    // "Đã xác nhận" and the legacy normalization close a trip around lines
    // approval would have frozen first; the trip's state is what refuses them.
    const { service, costs } = build(line(), 'finished');

    await expect(service.editCost(ASSIGNMENT, 'cost-1', { amount: '1550000.00' }, DRIVER)).rejects.toThrow(
      ConflictError,
    );
    expect(costs.lockById).not.toHaveBeenCalled();
    expect(costs.editEditable).not.toHaveBeenCalled();
  });

  it('logs every field that moved, with the value before and after', async () => {
    const { service, costs } = build(line());

    await service.editCost(ASSIGNMENT, 'cost-1', { amount: '1550000.00' }, DRIVER);

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

    await service.editCost(ASSIGNMENT, 'cost-1', { amount: '1500000.00' }, DRIVER);

    expect(costs.editEditable).not.toHaveBeenCalled();
    expect(costs.recordEdits).not.toHaveBeenCalled();
  });

  it('★ refuses a line that belongs to another assignment, even the same driver’s other lorry', async () => {
    const { service, costs } = build(line({ driverAssignmentId: 'assignment-2' }));

    await expect(
      service.editCost(ASSIGNMENT, 'cost-1', { amount: '9.00' }, DRIVER),
    ).rejects.toThrow(NotFoundError);
    expect(costs.editEditable).not.toHaveBeenCalled();
  });

  it('refuses a line frozen by a pending completion', async () => {
    const { service } = build(line({ state: 'locked' }));

    await expect(
      service.editCost(ASSIGNMENT, 'cost-1', { amount: '9.00' }, DRIVER),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses a line that approval made final', async () => {
    const { service } = build(line({ state: 'immutable' }));

    await expect(
      service.editCost(ASSIGNMENT, 'cost-1', { amount: '9.00' }, DRIVER),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses a backoffice line, which is corrected by voiding', async () => {
    // ★ 0012's rule is untouched for the rows it was written for.
    const { service } = build(line({ source: 'backoffice', state: 'editable' }));

    await expect(
      service.editCost(ASSIGNMENT, 'cost-1', { amount: '9.00' }, DRIVER),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses a driver correcting somebody else’s figure', async () => {
    const { service } = build(line());

    await expect(
      service.editCost(ASSIGNMENT, 'cost-1', { amount: '9.00' }, OTHER),
    ).rejects.toThrow(ForbiddenError);
  });

  it('turns a concurrent submit into a conflict rather than a missing row', async () => {
    const { service, costs } = build(line());
    costs.editEditable.mockResolvedValue(null);

    await expect(
      service.editCost(ASSIGNMENT, 'cost-1', { amount: '1550000.00' }, DRIVER),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses an amount NUMERIC(14,2) cannot hold exactly', async () => {
    const { service } = build(line());

    await expect(
      service.editCost(ASSIGNMENT, 'cost-1', { amount: '10.005' }, DRIVER),
    ).rejects.toThrow(ValidationError);
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

  it('★ withdraws with no reason at all, and stores none', async () => {
    // 0021 made the reason optional: a record is withdrawn through a plain
    // confirmation, so nothing is typed. Null, never a manufactured sentence
    // — a reader cannot tell an invented reason from one a person wrote.
    const { service, costs } = build();

    const result = await service.voidCost(TRIP, 'cost-1', { by: BOSS });

    expect(costs.void).toHaveBeenCalledWith('cost-1', BOSS, null, expect.any(Date));
    expect(result.voidedBy).toBe(BOSS);
  });

  it('★ treats a reason of pure whitespace as no reason', async () => {
    const { service, costs } = build();

    await service.voidCost(TRIP, 'cost-1', { by: BOSS, reason: '   ' });

    expect(costs.void).toHaveBeenCalledWith('cost-1', BOSS, null, expect.any(Date));
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
      lockActiveByVehicle: jest.fn().mockResolvedValue(null),
      lockActiveById: jest.fn().mockResolvedValue(activeAssignment),
      assign: jest.fn().mockResolvedValue({ ...activeAssignment, id: 'assignment-2' }),
      end: jest.fn().mockResolvedValue({ ...activeAssignment, state: 'ended' }),
    };
    const events = { findByClientEventId: jest.fn(), hasLiveEvents: jest.fn().mockResolvedValue(false) };
    const vehicles = {
      findById: jest.fn().mockResolvedValue({ id: VEHICLE, status: 'active' }),
      findForShare: jest.fn().mockResolvedValue({ id: VEHICLE, status: 'active' }),
    };
    const requests = { listByAssignment: jest.fn().mockResolvedValue([]) };
    const service = new TripExecutionService(
      database(),
      trips as never,
      assignments as never,
      events as never,
      vehicles as never,
      users as never,
      notifications as never,
      requests as never,
      { record: jest.fn() } as never,
      { exists: jest.fn().mockResolvedValue(false) } as never,
      new DispatchCrew(assignments as never, vehicles as never, users as never, notifications as never, noAsks() as never),
    );
    return { service, trips, assignments, users, notifications };
  };

  const pairWith = (driverUserId: string) => ({ vehicleId: VEHICLE, driverUserId });

  it('refuses a person who does not exist', async () => {
    const { service, users } = build();
    users.findById.mockResolvedValue(null);
    await expect(service.assign(TRIP, pairWith('nobody'), BOSS)).rejects.toThrow(NotFoundError);
  });

  it('★ refuses an employee account — only a driver account drives', async () => {
    const { service, users, assignments } = build();
    users.findById.mockResolvedValue({ id: OTHER, accountType: 'employee', status: 'active' });

    await expect(service.assign(TRIP, pairWith(OTHER), BOSS)).rejects.toThrow(ValidationError);
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('refuses a disabled driver account', async () => {
    const { service, users, assignments } = build();
    users.findById.mockResolvedValue({ id: DRIVER, accountType: 'driver', status: 'disabled' });

    await expect(service.assign(TRIP, pairWith(DRIVER), BOSS)).rejects.toThrow(ConflictError);
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('refuses a closed trip before looking at the driver', async () => {
    const { service, trips, users } = build();
    trips.lockActive.mockResolvedValue(openTrip({ status: 'finished' }));

    await expect(service.assign(TRIP, pairWith(DRIVER), BOSS)).rejects.toThrow(ConflictError);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('★ records TRIP_ASSIGNED inside the transaction, naming the lorry, and delivers it after', async () => {
    const { service, notifications } = build();

    await service.assign(TRIP, pairWith(DRIVER), BOSS);

    expect(notifications.record).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: DRIVER,
        type: 'TRIP_ASSIGNED',
        tripId: TRIP,
        // A driver on three lorries of one trip gets three of these; the
        // plate is what tells them apart.
        detail: '50H49266',
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

    await expect(service.assign(TRIP, pairWith(DRIVER), BOSS)).rejects.toThrow('unique index');
    expect(notifications.deliver).not.toHaveBeenCalled();
  });

  it('★ tells both drivers on a replacement, each about their own turn', async () => {
    const { service, assignments, users, notifications } = build();
    users.findById.mockResolvedValue({ id: OTHER, accountType: 'driver', status: 'active' });
    assignments.assign.mockResolvedValue({ ...activeAssignment, id: 'assignment-2', driverUserId: OTHER });

    await service.replaceDriver(TRIP, ASSIGNMENT, OTHER, { by: BOSS, reason: 'sick' });

    const recorded = notifications.record.mock.calls.map(([input]) => input);
    expect(recorded).toEqual([
      expect.objectContaining({ recipientUserId: DRIVER, type: 'TRIP_UNASSIGNED', eventKey: 'assignment:assignment-1:ended' }),
      expect.objectContaining({ recipientUserId: OTHER, type: 'TRIP_ASSIGNED', eventKey: 'assignment:assignment-2:assigned' }),
    ]);
    expect(notifications.deliver).toHaveBeenCalledTimes(1);
  });

  it('tells the driver taken off a trip', async () => {
    const { service, notifications } = build();

    await service.endAssignment(TRIP, ASSIGNMENT, { by: BOSS, reason: 'trip cancelled' });

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

/**
 * ★ AND THE DELIVERY IS CONFIRMED THE SAME WAY THE PICKUP IS: by the tap.
 *
 * Kept as its own suite because the delivery END is the one that would be
 * measured against the DELIVERY point if the check were ever switched back on —
 * confirming against the pickup's point was a real bug once, and these cases are
 * where its return would be caught.
 */
describe('★ confirming a delivery takes no position either', () => {
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
    const assignments = {
      findActiveById: jest.fn().mockResolvedValue(activeAssignment),
      lockActiveById: jest.fn().mockResolvedValue(activeAssignment),
    };
    const events = {
      findByClientEventId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue({ id: 'event-4' }),
      listByAssignment: jest.fn().mockResolvedValue([
        { type: 'ARRIVED_PICKUP' },
        { type: 'PICKUP_CONFIRMED' },
        { type: 'ARRIVED_DELIVERY' },
      ]),
    };
    const vehicles = {
      findById: jest.fn().mockResolvedValue({ id: VEHICLE, ownership: 'company' }),
      findForShare: jest.fn().mockResolvedValue({ id: VEHICLE, ownership: 'company' }),
    };
    const service = new TripExecutionService(
      database(),
      trips as never,
      assignments as never,
      events as never,
      vehicles as never,
      drivers() as never,
      told() as never,
      { listByAssignment: jest.fn().mockResolvedValue([]) } as never,
      { record: jest.fn() } as never,
      { exists: jest.fn().mockResolvedValue(false) } as never,
      new DispatchCrew(assignments as never, vehicles as never, drivers() as never, told() as never, noAsks() as never),
    );
    return { service, events };
  };

  const delivering = {
    assignmentId: ASSIGNMENT,
    type: 'DELIVERY_CONFIRMED' as const,
    deviceReportedAt: SENT_AT,
    clientEventId: 'tap-4',
    recordedBy: DRIVER,
  };

  it('★ records the confirmation from the tap, with no reading and no verdict', async () => {
    const { service, events } = build();

    await service.recordEvent(delivering);

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DELIVERY_CONFIRMED',
        location: null,
        geofencePassed: null,
        distanceM: null,
      }),
      TX,
    );
  });

  it('★ does not refuse a reading taken at the PICKUP point — nothing compares the two ends', async () => {
    const { service, events } = build();
    const atPickup = { ...atDelivery, latitude: 10.8188, longitude: 106.6564 };

    await service.recordEvent({ ...delivering, location: atPickup });

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ location: atPickup, geofencePassed: null }),
      TX,
    );
  });

  it('records the confirmation when the trip has no delivery coordinates yet', async () => {
    const { service, events } = build({ deliveryLatitude: null, deliveryLongitude: null });

    await service.recordEvent(delivering);

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DELIVERY_CONFIRMED', geofencePassed: null }),
      TX,
    );
  });

  it('still refuses a delivery before the pickup was confirmed ON THIS ASSIGNMENT', async () => {
    // Assignment B's pickup confirmation is not this assignment's.
    const { service, events } = build();
    events.listByAssignment.mockResolvedValue([{ type: 'ARRIVED_PICKUP' }]);

    await expect(service.recordEvent({ ...delivering, location: atDelivery })).rejects.toThrow(
      ConflictError,
    );
  });

  it('reaches no verdict on the arrival at delivery either', async () => {
    const { service, events } = build();
    events.listByAssignment.mockResolvedValue([{ type: 'ARRIVED_PICKUP' }, { type: 'PICKUP_CONFIRMED' }]);

    await service.recordEvent({ ...delivering, type: 'ARRIVED_DELIVERY', clientEventId: 'tap-3' });

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ARRIVED_DELIVERY', geofencePassed: null }),
      TX,
    );
  });
});

describe('★ a completion decision is told to the person who asked', () => {
  const build = () => {
    const trips = {
      lockActive: jest.fn().mockResolvedValue(openTrip()),
      updateStatus: jest.fn().mockResolvedValue(openTrip({ status: 'finished' })),
      markClosed: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
    };
    const assignments = {
      findActiveById: jest.fn().mockResolvedValue(activeAssignment),
      lockActiveById: jest.fn().mockResolvedValue(activeAssignment),
    };
    const requests = {
      lockById: jest.fn().mockResolvedValue(pendingRequest()),
      lockPendingByAssignment: jest.fn(),
      submit: jest.fn(),
      decide: jest.fn().mockResolvedValue({ id: REQUEST, state: 'approved' }),
      listByTrip: jest.fn().mockResolvedValue([]),
      hasUnapprovedActiveAssignment: jest.fn().mockResolvedValue(false),
    };
    const costs = {
      lockForAssignment: jest.fn(),
      unlockForAssignment: jest.fn().mockResolvedValue(1),
      finalizeForAssignment: jest.fn().mockResolvedValue(1),
      listActiveByAssignment: jest.fn().mockResolvedValue([]),
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
      { listByAssignment: jest.fn().mockResolvedValue(FULL_JOURNEY) } as never,
      noAsks() as never,
      reviewer() as never,
    );
    return { service, assignments, requests, notifications };
  };

  it('★ carries the reason on a rejection, to the driver who submitted', async () => {
    const { service, notifications } = build();

    await service.reject(TRIP, REQUEST, { by: BOSS, reason: 'Thiếu hoá đơn dầu' });

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

  it('tells the driver their turn is closed on approval', async () => {
    const { service, notifications } = build();

    await service.approve(TRIP, REQUEST, BOSS);

    expect(notifications.record).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: DRIVER,
        type: 'COMPLETION_APPROVED',
        eventKey: 'completion:request-1:approved',
      }),
      TX,
    );
  });

  it('★ addresses the SUBMITTER of the request, never whoever is on the trip now', async () => {
    // With several turns on one trip "the driver on the trip" is several
    // people; with none it is nobody. The request row says who asked.
    const { service, requests, notifications } = build();
    requests.lockById.mockResolvedValue(pendingRequest({ submittedBy: OTHER }));

    await service.approve(TRIP, REQUEST, BOSS);

    expect(notifications.record).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: OTHER }),
      TX,
    );
    expect(notifications.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: DRIVER }),
      TX,
    );
  });

  it('delivers nothing when the decision is refused', async () => {
    const { service, requests, notifications } = build();
    requests.lockById.mockResolvedValue(null);

    await expect(service.approve(TRIP, REQUEST, BOSS)).rejects.toThrow(NotFoundError);
    expect(notifications.deliver).not.toHaveBeenCalled();
  });
});
