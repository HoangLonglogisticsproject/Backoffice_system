import { randomBytes, randomUUID } from 'node:crypto';
import axios, { AxiosHeaders, type AxiosInstance } from 'axios';
import { beforeAll, describe, expect, it } from 'vitest';
import { toApiError } from '@/utils/errors';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@/api/client';
import type { DriverTripDetail } from '@/types/driver';
import { assignmentStatusOf } from '@/utils/driverExecution';
import { scheduleViewOf } from '@/utils/driverSchedule';
import { businessInstant, todayAsCalendarDay } from '@/utils/format/datetime';
import {
  BASE_URL,
  fixturePassword,
  requireBossCredentials,
  type BossCredentials,
} from '../helpers/integration-credentials';

/**
 * The bootstrap credential, read in `beforeAll` — which is also where a
 * missing variable is reported, by name, before any request is made.
 */
let credentials: BossCredentials;

/**
 * Fixture passwords, generated per run. Two drivers, each with a temporary
 * credential and the one they replace it with — four values, kept DISTINCT.
 */
const TEMPORARY_A = fixturePassword('temporary-a');
const CHOSEN_A = fixturePassword('chosen-a');
const TEMPORARY_B = fixturePassword('temporary-b');
const CHOSEN_B = fixturePassword('chosen-b');
/** Office staff for the fleet board's role matrix — their own pair, distinct from the drivers'. */
const TEMPORARY_STAFF = fixturePassword('temporary-staff');
const CHOSEN_STAFF = fixturePassword('chosen-staff');

/**
 * The Driver Portal's read and write paths, against a REAL backend and a REAL
 * PostgreSQL.
 *
 * The D1 screens were built against `types/driver.ts`, and every stage the
 * portal shows is DERIVED client-side from what these routes return. A mock
 * agrees with whatever the type says; this file asks the server whether the
 * type is still true, and whether the derivations land where the screens
 * expect when fed a real response.
 *
 * Nothing is mocked. Requires a running backend (API_BASE_URL, default
 * http://localhost:3000) and a bootstrapped SuperAdmin.
 */

type Client = AxiosInstance & { cookie: string | null };

function makeClient(): Client {
  const client = axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  }) as Client;

  client.cookie = null;

  client.interceptors.request.use((config) => {
    const method = (config.method ?? 'get').toLowerCase();
    config.headers = config.headers ?? new AxiosHeaders();
    if (!['get', 'head', 'options'].includes(method)) {
      config.headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
    }
    if (client.cookie) config.headers.set('Cookie', client.cookie);
    return config;
  });

  client.interceptors.response.use((response) => {
    const setCookie = response.headers['set-cookie'];
    if (Array.isArray(setCookie)) {
      const session = setCookie.find((c) => c.startsWith('bo_session='));
      if (session) {
        const value = session.split(';')[0];
        client.cookie = value.endsWith('=') ? null : value;
      }
    }
    return response;
  });

  return client;
}

const login = (client: Client, email: string, password: string) =>
  client.post('/auth/login', { subject: email, password });

/**
 * The keys each frontend type reads, spelled out because a TS interface is
 * gone at runtime. ★ COMPARED AS EXACT SETS: a missing key is a screen reading
 * `undefined`, and an extra one is the whitelist growing without the type
 * hearing about it — both are drift, in opposite directions.
 */
const DRIVER_TRIP_KEYS = [
  'tripId',
  'scheduledOn',
  'vehicle',
  'customer',
  'pickupAddress',
  'pickupContact',
  'deliveryAddress',
  'deliveryContact',
  'cargoInfo',
  'pickupLocation',
  'deliveryLocation',
  'scheduledPickupAt',
  'scheduledDeliveryAt',
  'driverInstructions',
  'assignment',
];
// `closed`: the trip is finished — the detail of a "Đã chạy xong" card, with no
// milestone and no completion. `expensesOpen`: whether money may be written —
// the server's answer, which the screen reads and never re-derives.
// `fuelOnVehicle`: the lorry declares its fuel daily, so `fuel` is no trip line.
const DETAIL_KEYS = [
  ...DRIVER_TRIP_KEYS,
  'events',
  'expenses',
  'accountability',
  'completion',
  'closed',
  'expensesOpen',
  'fuelOnVehicle',
];
const EVENT_KEYS = [
  'id',
  'tripId',
  'driverAssignmentId',
  'type',
  'vehicleId',
  'vehicleOwnership',
  'scheduledAt',
  'actualAt',
  'recordedAt',
  'deviceReportedAt',
  'location',
  'geofencePassed',
  'distanceM',
  'recordedBy',
  'recordedByUser',
  'voidedAt',
  'voidedBy',
  'voidReason',
];
const COST_KEYS = [
  'id',
  'tripId',
  'note',
  'createdBy',
  'createdAt',
  'createdByUser',
  'voidedAt',
  'voidedBy',
  'voidReason',
  'category',
  'amount',
  'state',
  'source',
  'driverAssignmentId',
  'vehicleId',
  'vehicleOwnership',
  'lockedAt',
  'lockedBy',
];
const COMPLETION_KEYS = [
  'id',
  'tripId',
  'driverAssignmentId',
  'attemptNo',
  'expenseDeclaration',
  'state',
  'submittedBy',
  'submittedByUser',
  'submittedAt',
  'decidedBy',
  'decidedAt',
  'decisionReason',
];

const keysOf = (value: object) => Object.keys(value).sort();
const sorted = (keys: string[]) => [...keys].sort();

/** `YYYY-MM-DD` plus `days`, on the calendar — no time of day is involved. */
const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * ★ A PICKUP A BOOKING MAY TAKE, WHENEVER THE SUITE RUNS. A booking is "now or
 * later" and today's must say its hour, so no fixed wall-clock time is safe —
 * 08:00 fails after breakfast, 23:59 near midnight. Half an hour from the
 * business now, on the minute; or, when that crosses midnight, 08:00 tomorrow.
 */
const bookablePickup = (now = new Date()): { day: string; pickupAt: string } => {
  const soon = new Date(Math.ceil((now.getTime() + 30 * 60_000) / 60_000) * 60_000);
  const today = todayAsCalendarDay(now);
  if (todayAsCalendarDay(soon) === today) return { day: today, pickupAt: soon.toISOString() };
  const tomorrow = shiftDay(today, 1);
  return { day: tomorrow, pickupAt: businessInstant(tomorrow, '08:00') };
};

/** `Date.toJSON` — the ONLY stamp shape the portal's string comparisons are safe on. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('driver portal (D1) against the real API', () => {
  const unique = randomBytes(4).toString('hex');
  const today = todayAsCalendarDay();
  /** The shared trip's day and pickup — today's, or tomorrow's near midnight. */
  const booked = bookablePickup();
  const SELL_PRICE = '4500000.00';
  const customerName = `Driver Portal Customer ${unique}`;

  let boss: Client;
  let driverA: Client;
  let driverAId: string;
  let driverB: Client;
  let driverBUserId: string;
  let tripId: string;
  /** Driver A's turn that nothing below writes to — the read tests' subject. */
  let untouchedId: string;
  /** Driver B's own turn on the same trip, so "not yours" is not "has none". */
  let driverBAssignmentId: string;

  /**
   * Creates a driver, walks the temporary-credential gate, returns a client.
   * ★ `POST /driver-accounts` — a SuperAdmin creates a driver outright; the
   * request-and-approve path exists for heads, who cannot.
   */
  const provisionDriver = async (label: string, temporary: string, chosen: string) => {
    const email = `dp-${label}-${unique}@hoanglonglti.com`;
    const created = await boss.post('/driver-accounts', {
      displayName: `Driver ${label.toUpperCase()} ${unique}`,
      email,
      initialPassword: temporary,
    });
    expect(created.status).toBe(201);

    const setup = makeClient();
    expect((await login(setup, email, temporary)).status).toBe(200);
    expect(
      (await setup.post('/auth/password', { currentPassword: temporary, newPassword: chosen }))
        .status,
    ).toBe(204);

    const client = makeClient();
    expect((await login(client, email, chosen)).status).toBe(200);
    return { client, userId: created.data.userId as string, email };
  };

  /**
   * One more lorry on the shared trip, for `driverUserId`.
   * ★ A NEW LORRY EACH TIME: a lorry is on a trip once, but the same driver on
   * a second lorry is ordinary dispatch — so every write test gets a turn of
   * its own and none depends on the order the others ran in.
   */
  let lorries = 0;
  const assignLorry = async (driverUserId: string) => {
    lorries += 1;
    const vehicle = await boss.post('/trip-vehicles', { plate: `DP-${unique}-${lorries}` });
    expect(vehicle.status).toBe(201);

    const assigned = await boss.post(`/trip-schedules/${tripId}/driver-assignments`, {
      vehicleId: vehicle.data.id,
      driverUserId,
    });
    expect(assigned.status).toBe(201);
    return assigned.data.id as string;
  };

  /** Tân Sơn Nhất cargo, then District 1: the two points a walkable trip runs between. */
  const PICKUP_POINT = { latitude: 10.8188, longitude: 106.6564 };
  const DELIVERY_POINT = { latitude: 10.7769, longitude: 106.7009 };
  let places = 0;
  let journeyCustomer: string | null = null;
  /** A trip names its customer's own places only, so the walkable trips share one customer. */
  const customerForJourneys = async (): Promise<string> => {
    if (journeyCustomer) return journeyCustomer;
    const created = await boss.post('/trip-customers', { name: `Journey Customer ${unique}` });
    expect(created.status).toBe(201);
    journeyCustomer = created.data.id as string;
    return journeyCustomer;
  };
  const placeAt = async (customerId: string, point: { latitude: number; longitude: number }) => {
    places += 1;
    const created = await boss.post(`/trip-customers/${customerId}/locations`, {
      name: `Journey ${unique} ${places}`,
      address: `Journey address ${unique} ${places}`,
      ...point,
    });
    expect(created.status).toBe(201);
    return created.data.id as string;
  };
  /** A booking whose two ends carry points — so the whole journey can be confirmed. */
  const walkableBooking = async (): Promise<string> => {
    const { day, pickupAt } = bookablePickup();
    const customerId = await customerForJourneys();
    const created = await boss.post('/trip-schedules', {
      scheduledOn: day,
      pickupAt,
      customerId,
      pickupLocationId: await placeAt(customerId, PICKUP_POINT),
      deliveryLocationId: await placeAt(customerId, DELIVERY_POINT),
      sellPrice: SELL_PRICE,
      entryMode: 'operational',
    });
    expect(created.status).toBe(201);
    return created.data.id as string;
  };
  /** One more lorry, on any trip. */
  const lorryOn = async (trip: string, driverUserId: string) => {
    lorries += 1;
    const vehicle = await boss.post('/trip-vehicles', { plate: `DPW-${unique}-${lorries}` });
    expect(vehicle.status).toBe(201);
    const assigned = await boss.post(`/trip-schedules/${trip}/driver-assignments`, {
      vehicleId: vehicle.data.id,
      driverUserId,
    });
    expect(assigned.status).toBe(201);
    return assigned.data.id as string;
  };
  /** Reports these milestones on a turn of driver A's, as the handset sends them — a reading at each confirmation. */
  const walk = async (turn: string, types: readonly string[]) => {
    for (const type of types) {
      const point = (type === 'PICKUP_CONFIRMED' && PICKUP_POINT) || (type === 'DELIVERY_CONFIRMED' && DELIVERY_POINT);
      const reported = await driverA.post(`/driver/assignments/${turn}/execution-events`, {
        type,
        deviceReportedAt: new Date().toISOString(),
        clientEventId: `${turn}:${type}`,
        ...(point ? { location: { ...point, accuracyM: 10, capturedAt: new Date().toISOString() } } : {}),
      });
      expect([type, reported.status]).toEqual([type, 201]);
    }
  };
  const JOURNEY = ['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED'] as const;

  const detailOf = async (assignmentId: string) => {
    const response = await driverA.get(`/driver/assignments/${assignmentId}`);
    expect(response.status).toBe(200);
    return response.data as DriverTripDetail;
  };

  beforeAll(async () => {
    credentials = requireBossCredentials();

    const health = await axios.get(`${BASE_URL}/health`, { validateStatus: () => true });
    if (health.status !== 200) {
      throw new Error(`No backend at ${BASE_URL} (health ${health.status}).`);
    }

    boss = makeClient();
    if ((await login(boss, credentials.email, credentials.password)).status !== 200) {
      throw new Error(`Could not sign in as ${credentials.email}. Bootstrap a SuperAdmin first.`);
    }

    const a = await provisionDriver('a', TEMPORARY_A, CHOSEN_A);
    const b = await provisionDriver('b', TEMPORARY_B, CHOSEN_B);
    driverA = a.client;
    driverAId = a.userId;
    driverB = b.client;

    const customer = await boss.post('/trip-customers', { name: customerName });
    expect(customer.status).toBe(201);

    // A SuperAdmin may price a trip, so the create route REQUIRES a sell price
    // from them. It is also the figure the tests below prove never reaches a driver.
    const trip = await boss.post('/trip-schedules', {
      scheduledOn: booked.day,
      customerId: customer.data.id,
      pickupAddress: `Pickup ${unique}`,
      deliveryAddress: `Delivery ${unique}`,
      pickupAt: booked.pickupAt,
      sellPrice: SELL_PRICE,
    });
    expect(trip.status).toBe(201);
    tripId = trip.data.id;

    untouchedId = await assignLorry(driverAId);
    driverBUserId = b.userId;
    driverBAssignmentId = await assignLorry(b.userId);
  });

  // ---------------------------------------------------- provisioning gate --

  it('★ a driver still on the temporary password is refused the schedule — 403 PASSWORD_CHANGE_REQUIRED', async () => {
    // The portal's first-login screen relies on exactly this answer. The list
    // route has no assignment guard, so the gate there is its own guard.
    const created = await boss.post('/driver-accounts', {
      displayName: `Driver Gate ${unique}`,
      email: `dp-gate-${unique}@hoanglonglti.com`,
      initialPassword: TEMPORARY_A,
    });
    expect(created.status).toBe(201);

    const fresh = makeClient();
    expect((await login(fresh, `dp-gate-${unique}@hoanglonglti.com`, TEMPORARY_A)).status).toBe(200);

    const response = await fresh.get('/driver/assignments');
    expect(response.status).toBe(403);
    expect(toApiError(response.status, response.data).code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  // ---------------------------------------------------------------- reads --

  describe('GET /driver/assignments', () => {
    it('lists the new turn with exactly the DriverTrip fields, on its booked day', async () => {
      const response = await driverA.get('/driver/assignments');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);

      const item = response.data.find(
        (row: { assignment: { id: string } }) => row.assignment.id === untouchedId,
      );
      expect(item).toBeDefined();
      expect(keysOf(item)).toEqual(sorted(DRIVER_TRIP_KEYS));

      expect(item).toMatchObject({
        tripId,
        scheduledOn: booked.day,
        vehicle: { id: expect.any(String), plate: `DP-${unique}-1` },
        customer: { id: expect.any(String), name: customerName },
        pickupAddress: `Pickup ${unique}`,
        deliveryAddress: `Delivery ${unique}`,
        scheduledPickupAt: booked.pickupAt,
        assignment: { id: untouchedId, assignedAt: expect.stringMatching(ISO_UTC) },
      });
      // ★ The day is TEXT, not an instant — `scheduleViewOf` compares it as a string.
      expect(item.scheduledOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(scheduleViewOf(item.scheduledOn, today)).toBe(booked.day === today ? 'today' : 'upcoming');
    });

    it('★ carries NO status, events, expenses, accountability or completion — why D1 has no "completed" tab', async () => {
      // The list cannot say which work is finished, so the schedule splits by
      // day. If one of these ever appears, that decision can be revisited.
      const response = await driverA.get('/driver/assignments');
      expect(response.status).toBe(200);

      for (const item of response.data) {
        for (const key of ['status', 'events', 'expenses', 'accountability', 'completion']) {
          expect(item).not.toHaveProperty(key);
        }
      }
    });

    it('★ no money reaches the driver — the sell price is nowhere in the body', async () => {
      const response = await driverA.get('/driver/assignments');
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.data)).not.toContain('4500000');
    });

    it('lists only the caller’s own turns — driver B does not see driver A’s', async () => {
      const response = await driverB.get('/driver/assignments');

      expect(response.status).toBe(200);
      const ids = response.data.map((row: { assignment: { id: string } }) => row.assignment.id);
      expect(ids).toContain(driverBAssignmentId);
      expect(ids).not.toContain(untouchedId);
    });
  });

  describe('GET /driver/assignments/:assignmentId', () => {
    it('answers the DriverTripDetail shape, empty, and reads as "assigned"', async () => {
      const detail = await detailOf(untouchedId);

      expect(keysOf(detail)).toEqual(sorted(DETAIL_KEYS));
      expect(detail).toMatchObject({
        tripId,
        scheduledOn: booked.day,
        assignment: { id: untouchedId },
        events: [],
        expenses: [],
        accountability: 'NOT_DECLARED',
        completion: null,
        closed: false,
        expensesOpen: true,
      });
      expect(assignmentStatusOf(detail)).toBe('assigned');
      expect(JSON.stringify(detail)).not.toContain('4500000');
    });
  });

  // --------------------------------------------------------------- access --

  describe('who may read', () => {
    it('anonymous — 401 on the list and on one assignment', async () => {
      const anonymous = makeClient();

      expect((await anonymous.get('/driver/assignments')).status).toBe(401);
      expect((await anonymous.get(`/driver/assignments/${untouchedId}`)).status).toBe(401);
    });

    it('★ the SuperAdmin is an EMPLOYEE, not a driver — 403 on the list', async () => {
      // No global bypass: the portal is the driver's, and an administrator is
      // the wrong actor rather than an under-privileged one.
      const response = await boss.get('/driver/assignments');
      expect(response.status).toBe(403);
    });

    it('another driver — 403 on driver A’s assignment id', async () => {
      const response = await driverB.get(`/driver/assignments/${untouchedId}`);

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
      expect(JSON.stringify(response.data)).not.toContain(tripId);
    });

    it('★ a well-formed id that exists nowhere — 403, the same answer as "not yours"', async () => {
      // The guard does not tell "no such turn" from "somebody else's", so an
      // id reveals nothing about work that is not the caller's.
      const response = await driverA.get(`/driver/assignments/${randomUUID()}`);

      expect(response.status).toBe(403);
      expect(toApiError(response.status, response.data).code).toBe('FORBIDDEN');
    });

    it('⚠ a malformed id is refused and leaks nothing — status NOT pinned (backend follow-up)', async () => {
      // ⚠ TODAY THIS IS A 500. `ActiveAssignmentGuard` runs before the
      // `UuidParam` pipe and queries `WHERE a.id = $1` with the raw text, so
      // PostgreSQL rejects the cast and the error escapes unhandled as
      // `{"statusCode":500,"message":"Internal server error"}` — not even the
      // API's own error envelope. The pipe would have answered 422 "Malformed
      // identifier." had it run first. Only what is safe either way is pinned
      // here; tighten to the 4xx once the guard validates the id itself.
      const response = await driverA.get('/driver/assignments/not-a-uuid');

      expect(response.status).toBeGreaterThanOrEqual(400);
      const body = JSON.stringify(response.data);
      expect(body).not.toContain(tripId);
      expect(body).not.toContain(customerName);
    });
  });

  // -------------------------------------- the writes the portal already makes --

  describe('existing writes, with the bodies api/driverPortal.ts sends', () => {
    it('★ ARRIVED_PICKUP records, a retry answers the SAME event, and the turn reads "at-pickup"', async () => {
      const assignmentId = await assignLorry(driverAId);
      // One id per INTENT, as the portal mints it — so the retry collides.
      const body = {
        type: 'ARRIVED_PICKUP',
        deviceReportedAt: new Date().toISOString(),
        clientEventId: `${assignmentId}:ARRIVED_PICKUP`,
      };

      const first = await driverA.post(`/driver/assignments/${assignmentId}/execution-events`, body);
      expect(first.status).toBe(201);
      expect(keysOf(first.data)).toEqual(sorted(EVENT_KEYS));
      expect(first.data).toMatchObject({
        driverAssignmentId: assignmentId,
        tripId,
        type: 'ARRIVED_PICKUP',
        recordedBy: driverAId,
        actualAt: expect.stringMatching(ISO_UTC),
        recordedAt: expect.stringMatching(ISO_UTC),
        voidedAt: null,
      });

      const retry = await driverA.post(`/driver/assignments/${assignmentId}/execution-events`, body);
      expect(retry.status).toBe(201);
      expect(retry.data.id).toBe(first.data.id);

      const detail = await detailOf(assignmentId);
      expect(detail.events).toHaveLength(1);
      expect(assignmentStatusOf(detail)).toBe('at-pickup');
    });

    it('a declared expense comes back on the detail as the driver’s own line', async () => {
      const assignmentId = await assignLorry(driverAId);

      const declared = await driverA.post(`/driver/assignments/${assignmentId}/expenses`, {
        category: 'loading',
        amount: '150000.00',
        clientRequestId: `${assignmentId}:loading`,
      });
      expect(declared.status).toBe(201);
      expect(keysOf(declared.data)).toEqual(sorted(COST_KEYS));

      const detail = await detailOf(assignmentId);
      expect(detail.expenses).toHaveLength(1);
      expect(detail.expenses[0]).toMatchObject({
        id: declared.data.id,
        category: 'loading',
        // ★ Text, never a JSON number — the exact figure the driver typed.
        amount: '150000.00',
        source: 'driver_portal',
        driverAssignmentId: assignmentId,
        createdBy: driverAId,
        state: 'editable',
      });
    });

    it('★ a completion asked for before the journey is complete is refused — even straight at the API — and accepted once it is', async () => {
      const assignmentId = await lorryOn(await walkableBooking(), driverAId);
      await walk(assignmentId, JOURNEY.slice(0, 1));
      // `expenses` must match the lines — the server refuses a contradiction.
      expect(
        (
          await driverA.post(`/driver/assignments/${assignmentId}/expenses`, {
            category: 'loading',
            amount: '150000.00',
            clientRequestId: `${assignmentId}:loading`,
          })
        ).status,
      ).toBe(201);

      // ★ Three milestones still owed. The handset would not offer the button;
      // the API refuses the request anyway — the rule is the server's.
      const early = await driverA.post(`/driver/assignments/${assignmentId}/completion-requests`, {
        expenseDeclaration: 'expenses',
      });
      expect(early.status).toBe(422);
      expect(toApiError(early.status, early.data).details).toEqual({ execution: 'EXECUTION_INCOMPLETE' });
      expect((await detailOf(assignmentId)).completion).toBeNull();

      await walk(assignmentId, JOURNEY.slice(1));
      const submitted = await driverA.post(`/driver/assignments/${assignmentId}/completion-requests`, {
        expenseDeclaration: 'expenses',
      });
      expect(submitted.status).toBe(201);
      expect(keysOf(submitted.data)).toEqual(sorted(COMPLETION_KEYS));
      expect(submitted.data).toMatchObject({
        driverAssignmentId: assignmentId,
        state: 'pending',
        expenseDeclaration: 'expenses',
        attemptNo: 1,
      });

      const detail = await detailOf(assignmentId);
      expect(detail.completion?.state).toBe('pending');
      expect(assignmentStatusOf(detail)).toBe('completion-pending');
      // Submitting freezes the figures it declared.
      expect(detail.expenses[0].state).toBe('locked');

      // ★ And the list STILL knows nothing of it — the schedule cannot move
      // this card anywhere, which is the D1 decision holding under real data.
      const list = await driverA.get('/driver/assignments');
      const item = list.data.find(
        (row: { assignment: { id: string } }) => row.assignment.id === assignmentId,
      );
      expect(keysOf(item)).toEqual(sorted(DRIVER_TRIP_KEYS));
    });
  });

  /**
   * ★ LỊCH XE'S LIFECYCLE, AGAINST THE REAL API: THE DRIVER STARTS IT, APPROVAL
   * CLOSES IT, AND THE OFFICE WRITES NO STATUS.
   *
   * A booking opens `pending` with no status in its body; the first live
   * milestone a driver reports moves it `executing` on the server; a driver's
   * completion request, once approved, closes it into Lịch sử chuyến. The one
   * office-side status write left is the integrity guard refusing the way back.
   * Each case books a trip of its own, so none depends on another's state.
   */
  describe('Lịch xe lifecycle against the real API', () => {
    const booking = async (): Promise<string> => {
      const { day, pickupAt } = bookablePickup();
      const created = await boss.post('/trip-schedules', {
        scheduledOn: day,
        pickupAt,
        pickupAddress: `Lifecycle pickup ${unique}`,
        deliveryAddress: `Lifecycle delivery ${unique}`,
        sellPrice: SELL_PRICE,
        entryMode: 'operational',
      });
      expect(created.status).toBe(201);
      return created.data.id as string;
    };
    const crew = async (trip: string, driverUserId: string): Promise<string> => {
      lorries += 1;
      const vehicle = await boss.post('/trip-vehicles', { plate: `LC-${unique}-${lorries}` });
      expect(vehicle.status).toBe(201);
      const assigned = await boss.post(`/trip-schedules/${trip}/driver-assignments`, {
        vehicleId: vehicle.data.id,
        driverUserId,
      });
      expect(assigned.status).toBe(201);
      return assigned.data.id as string;
    };
    const statusOf = async (trip: string) => (await boss.get(`/trip-schedules/${trip}`)).data.status as string;
    /** The trip as one of the two lists returns it — `undefined` when it is not on that list. */
    const listed = async (trip: string, lifecycle: 'operational' | 'history' = 'operational') => {
      const page = await boss.get('/trip-schedules', {
        // Today's, or tomorrow's when booked near midnight (`bookablePickup`).
        params: { from: today, to: shiftDay(today, 1), lifecycle, page: 1, limit: 200 },
      });
      expect(page.status).toBe(200);
      return page.data.items.find((row: { id: string }) => row.id === trip);
    };
    const arrive = (turn: string) =>
      driverA.post(`/driver/assignments/${turn}/execution-events`, {
        type: 'ARRIVED_PICKUP',
        deviceReportedAt: new Date().toISOString(),
        clientEventId: `${turn}:ARRIVED_PICKUP`,
      });

    it('★ a booking created with no status opens at pending; a correction with none leaves it there', async () => {
      const trip = await booking();
      expect(await statusOf(trip)).toBe('pending');

      const corrected = await boss.patch(`/trip-schedules/${trip}`, { note: `Đổi giờ ${unique}` });
      expect(corrected.status).toBe(200);
      expect(corrected.data.status).toBe('pending');
    });

    it('★ the driver\'s first milestone puts the trip on the road — no office write — and a retry changes nothing', async () => {
      const trip = await booking();
      const turn = await crew(trip, driverAId);
      expect((await listed(trip)).assignments[0].started).toBe(false);

      const first = await arrive(turn);
      expect(first.status).toBe(201);
      expect(await statusOf(trip)).toBe('executing');
      expect((await listed(trip)).assignments[0].started).toBe(true);

      // The handset retries the same tap: the same event, the same status.
      const retry = await arrive(turn);
      expect(retry.data.id).toBe(first.data.id);
      expect(await statusOf(trip)).toBe('executing');

      // The board's status history names the driver as the one who started it.
      const history = await boss.get(`/trip-schedules/${trip}/status-history`);
      expect(history.status).toBe(200);
      expect(history.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: 'pending', to: 'executing', reason: 'execution_started' }),
        ]),
      );
    });

    it('★ even a SuperAdmin cannot drive the lifecycle — no status route, no status edit, no status on a booking', async () => {
      const setByServer = (response: { status: number; data: unknown }) => {
        expect(response.status).toBe(422);
        expect(toApiError(response.status, response.data).details).toMatchObject({ status: 'STATUS_SET_BY_SERVER' });
      };

      // A booking cannot open on the road.
      const { day, pickupAt } = bookablePickup();
      setByServer(
        await boss.post('/trip-schedules', {
          scheduledOn: day,
          pickupAt,
          sellPrice: SELL_PRICE,
          entryMode: 'operational',
          status: 'executing',
        }),
      );

      const trip = await booking();
      // The board's old status route is gone.
      expect((await boss.patch(`/trip-schedules/${trip}/status`, { status: 'executing' })).status).toBe(404);
      // pending → executing is the driver's…
      setByServer(await boss.patch(`/trip-schedules/${trip}`, { status: 'executing' }));
      expect(await statusOf(trip)).toBe('pending');

      // …and once it is on the road, executing → pending is nobody's.
      expect((await arrive(await crew(trip, driverAId))).status).toBe(201);
      setByServer(await boss.patch(`/trip-schedules/${trip}`, { status: 'pending' }));
      expect(await statusOf(trip)).toBe('executing');
    });

    it('★ completion is the driver\'s request and the SuperAdmin\'s approval — then the trip is History\'s', async () => {
      const trip = await walkableBooking();
      const turn = await crew(trip, driverAId);
      // The whole journey first: a completion needs every milestone live.
      await walk(turn, JOURNEY);

      const asked = await driverA.post(`/driver/assignments/${turn}/completion-requests`, {
        expenseDeclaration: 'none',
      });
      expect(asked.status).toBe(201);
      // Under review, still operational — nobody moved the status.
      expect(await statusOf(trip)).toBe('executing');
      expect(await listed(trip)).toBeDefined();

      const approved = await boss.post(
        `/trip-schedules/${trip}/completion-requests/${asked.data.id}/approve`,
        {},
      );
      expect(approved.status).toBe(200);
      expect(await statusOf(trip)).toBe('finished');
      expect(await listed(trip)).toBeUndefined();
      expect(await listed(trip, 'history')).toBeDefined();

      // Lịch sử chuyến's correction re-sends its frozen `finished` — a no-op
      // the server accepts, so History keeps working exactly as it did.
      const corrected = await boss.patch(`/trip-schedules/${trip}`, {
        note: `Đã đối soát ${unique}`,
        status: 'finished',
      });
      expect(corrected.status).toBe(200);
      expect(corrected.data).toMatchObject({ status: 'finished', note: `Đã đối soát ${unique}` });

      // ★ A NORMAL finished trip stays read-only for the driver's money.
      expect((await detailOf(turn)).expensesOpen).toBe(false);
      const late = await driverA.post(`/driver/assignments/${turn}/expenses`, {
        category: 'toll',
        amount: '50000.00',
      });
      expect(late.status).toBe(409);
    });

    /**
     * ★ THE SERVER DECIDES "TODAY" ON ITS OWN CLOCK. Should midnight fall while
     * a request is in flight, either day's answer is honest — so a refusal is
     * checked against the business day before AND after the call, never a guess.
     */
    const refusedAs = async (
      send: () => Promise<{ status: number; data: unknown }>,
      answerOn: (day: string) => object,
    ) => {
      const before = todayAsCalendarDay();
      const response = await send();
      const after = todayAsCalendarDay();
      expect(response.status).toBe(422);
      expect([answerOn(before), answerOn(after)]).toContainEqual(toApiError(response.status, response.data).details);
    };
    const book = (body: { scheduledOn?: string; pickupAt?: string }) =>
      boss.post('/trip-schedules', { ...body, sellPrice: SELL_PRICE, entryMode: 'operational' });

    it('★ a booking is now or later — yesterday 422 PAST_DAY, today with no hour 422 TIME_REQUIRED, a later day 201 with or without one', async () => {
      await refusedAs(() => book({ scheduledOn: shiftDay(today, -1) }), () => ({ scheduledOn: 'PAST_DAY' }));

      const asked = todayAsCalendarDay();
      await refusedAs(
        () => book({ scheduledOn: asked }),
        (day) => (day === asked ? { pickupAt: 'TIME_REQUIRED' } : { scheduledOn: 'PAST_DAY' }),
      );

      // Two days out, so no midnight during the run can make it today.
      const later = shiftDay(todayAsCalendarDay(), 2);
      expect((await book({ scheduledOn: later })).status).toBe(201);
      expect((await book({ scheduledOn: later, pickupAt: businessInstant(later, '08:00') })).status).toBe(201);
    });

    it('★ a booking’s pickup hour is checked on the SERVER’s clock — minutes ago 422, half an hour ahead 201', async () => {
      // Two minutes ago: today's hour already gone — or, just past midnight, yesterday.
      const gone = new Date(Date.now() - 2 * 60_000);
      await refusedAs(
        () => book({ pickupAt: gone.toISOString() }),
        (day) => (todayAsCalendarDay(gone) < day ? { scheduledOn: 'PAST_DAY' } : { pickupAt: 'PAST_INSTANT' }),
      );

      const { day, pickupAt } = bookablePickup();
      const accepted = await book({ scheduledOn: day, pickupAt });
      expect(accepted.status).toBe(201);
      expect(accepted.data).toMatchObject({ status: 'pending', scheduledOn: day, pickupAt });
    });
  });

  /**
   * ★ A RUN RECORDED AFTER THE FACT ("Nhập chuyến cũ"): ITS DRIVER BACKFILLS
   * WHAT IT COST, AND NOTHING ELSE.
   *
   * The office records the run with its crew; the run's driver finds it in
   * "Đã chạy xong", opens it closed, and declares and corrects the money. The
   * line is the one ledger every cost screen reads. Once the trip is archived
   * the same assignment id reaches nothing — not the money, not the history.
   * The cases run in order: each builds on the line the one before wrote.
   */
  describe('★ a recorded run — the driver backfills its money', () => {
    const ranOn = shiftDay(today, -3);
    let recordedTrip: string;
    let recordedTurn: string;
    let lineId: string;

    const historyIds = async () => {
      const page = await driverA.get('/driver/history', { params: { limit: 50 } });
      expect(page.status).toBe(200);
      return page.data.trips.map((row: { assignment: { id: string } }) => row.assignment.id) as string[];
    };
    const historyRow = async (path: '/trip-schedules' | '/trip-schedules/export') => {
      const page = await boss.get(path, {
        params: { from: ranOn, to: ranOn, lifecycle: 'history', page: 1, limit: 200 },
      });
      expect(page.status).toBe(200);
      return page.data.items.find((row: { id: string }) => row.id === recordedTrip);
    };

    beforeAll(async () => {
      lorries += 1;
      const vehicle = await boss.post('/trip-vehicles', { plate: `HR-${unique}-${lorries}` });
      expect(vehicle.status).toBe(201);
      const recorded = await boss.post('/trip-schedules', {
        scheduledOn: ranOn,
        pickupAddress: `Recorded pickup ${unique}`,
        deliveryAddress: `Recorded delivery ${unique}`,
        sellPrice: SELL_PRICE,
        entryMode: 'historical',
        crew: [{ vehicleId: vehicle.data.id, driverUserId: driverAId }],
      });
      expect(recorded.status).toBe(201);
      expect(recorded.data.status).toBe('finished');
      recordedTrip = recorded.data.id;

      const turns = await boss.get(`/trip-schedules/${recordedTrip}/driver-assignments`);
      expect(turns.status).toBe(200);
      recordedTurn = turns.data.find((turn: { driverUserId: string }) => turn.driverUserId === driverAId).id;
    });

    it('★ is in the driver’s history, opens closed with its money open — and not to driver B', async () => {
      expect(await historyIds()).toContain(recordedTurn);

      const detail = await detailOf(recordedTurn);
      expect(keysOf(detail)).toEqual(sorted(DETAIL_KEYS));
      expect(detail).toMatchObject({ tripId: recordedTrip, closed: true, expensesOpen: true, expenses: [] });
      expect(JSON.stringify(detail)).not.toContain('4500000');

      expect((await driverB.get(`/driver/assignments/${recordedTurn}`)).status).toBe(403);
    });

    it('★ declares and corrects a figure, read back on the detail, the cost dialog, the History list and the export', async () => {
      const declared = await driverA.post(`/driver/assignments/${recordedTurn}/expenses`, {
        category: 'toll',
        amount: '250000.00',
        clientRequestId: `${recordedTurn}:toll`,
      });
      expect(declared.status).toBe(201);
      expect(keysOf(declared.data)).toEqual(sorted(COST_KEYS));
      lineId = declared.data.id;

      const corrected = await driverA.patch(`/driver/assignments/${recordedTurn}/expenses/${lineId}`, {
        amount: '275000.00',
      });
      expect(corrected.status).toBe(200);
      expect(corrected.data.amount).toBe('275000.00');

      const detail = await detailOf(recordedTurn);
      expect(detail.expensesOpen).toBe(true);
      expect(detail.expenses.map((line) => [line.id, line.amount, line.source])).toEqual([
        [lineId, '275000.00', 'driver_portal'],
      ]);

      // The office reads the same ledger, live — nothing re-snapshots it.
      const costs = await boss.get(`/trip-schedules/${recordedTrip}/costs`);
      expect(costs.status).toBe(200);
      expect(costs.data.total).toBe('275000.00');
      const summary = { total: '275000.00', itemCount: 1 };
      expect((await historyRow('/trip-schedules')).costSummary).toMatchObject(summary);
      expect((await historyRow('/trip-schedules/export')).costSummary).toMatchObject(summary);

      // Driver B cannot write to A's run.
      const other = await driverB.post(`/driver/assignments/${recordedTurn}/expenses`, {
        category: 'toll',
        amount: '1.00',
      });
      expect(other.status).toBe(403);
    });

    it('★ takes no milestone and no completion — money only', async () => {
      const event = await driverA.post(`/driver/assignments/${recordedTurn}/execution-events`, {
        type: 'ARRIVED_PICKUP',
        deviceReportedAt: new Date().toISOString(),
        clientEventId: `${recordedTurn}:ARRIVED_PICKUP`,
      });
      expect(event.status).toBe(403);
      const completion = await driverA.post(`/driver/assignments/${recordedTurn}/completion-requests`, {
        expenseDeclaration: 'none',
      });
      expect(completion.status).toBe(403);
      expect((await boss.get(`/trip-schedules/${recordedTrip}`)).data.status).toBe('finished');
    });

    it('★ once archived, the same assignment id reaches nothing — no money, no history, no detail', async () => {
      expect((await boss.post(`/trip-schedules/${recordedTrip}/archive`, {})).status).toBe(200);

      const declare = await driverA.post(`/driver/assignments/${recordedTurn}/expenses`, {
        category: 'toll',
        amount: '1.00',
      });
      expect(declare.status).toBe(403);
      const edit = await driverA.patch(`/driver/assignments/${recordedTurn}/expenses/${lineId}`, {
        amount: '1.00',
      });
      expect(edit.status).toBe(403);

      expect(await historyIds()).not.toContain(recordedTurn);
      expect((await driverA.get(`/driver/assignments/${recordedTurn}`)).status).toBe(403);
    });
  });
  /**
   * ★ A LORRY'S DAILY FUEL CHECK (0034) — the HTTP contract the handset and the
   * office read: the 422 that holds the day's first milestone, a declaration
   * whose lorry and day are the server's, the `fuel` trip line refused, and the
   * fill on the lorry's own ledger — never in the trip's total.
   */
  describe('★ a lorry’s daily fuel check', () => {
    const FILL_KEY = `fuel-${unique}`;
    let fuelTrip: string;
    let fuelTurn: string;
    let fuelVehicle: string;

    beforeAll(async () => {
      lorries += 1;
      const vehicle = await boss.post('/trip-vehicles', { plate: `FC-${unique}-${lorries}`, dailyFuelCheckRequired: true });
      expect(vehicle.status).toBe(201);
      expect(vehicle.data.dailyFuelCheckRequired).toBe(true);
      fuelVehicle = vehicle.data.id;

      const trip = await boss.post('/trip-schedules', {
        scheduledOn: booked.day,
        pickupAddress: `Fuel pickup ${unique}`,
        deliveryAddress: `Fuel delivery ${unique}`,
        pickupAt: booked.pickupAt,
        sellPrice: SELL_PRICE,
      });
      expect(trip.status).toBe(201);
      fuelTrip = trip.data.id;

      const assigned = await boss.post(`/trip-schedules/${fuelTrip}/driver-assignments`, {
        vehicleId: fuelVehicle,
        driverUserId: driverAId,
      });
      expect(assigned.status).toBe(201);
      fuelTurn = assigned.data.id;
    });

    const arrive = () =>
      driverA.post(`/driver/assignments/${fuelTurn}/execution-events`, {
        type: 'ARRIVED_PICKUP',
        deviceReportedAt: new Date().toISOString(),
        clientEventId: `${fuelTurn}:ARRIVED_PICKUP`,
      });

    it('the catalogue carries the policy — off unless an administrator sets it', async () => {
      lorries += 1;
      const plain = await boss.post('/trip-vehicles', { plate: `FC-${unique}-${lorries}` });
      expect(plain.data.dailyFuelCheckRequired).toBe(false);

      const turnedOn = await boss.patch(`/trip-vehicles/${plain.data.id}`, { dailyFuelCheckRequired: true });
      expect(turnedOn.status).toBe(200);
      expect(turnedOn.data.dailyFuelCheckRequired).toBe(true);
    });

    it('★ the day’s first milestone is held: 422 FUEL_DECLARATION_REQUIRED, nothing written, still pending', async () => {
      const detail = await detailOf(fuelTurn);
      expect(keysOf(detail)).toEqual(sorted(DETAIL_KEYS));
      expect(detail.fuelOnVehicle).toBe(true);

      const held = await arrive();
      expect(held.status).toBe(422);
      expect(toApiError(held.status, held.data).details).toEqual({ dailyFuelCheck: 'FUEL_DECLARATION_REQUIRED' });

      expect((await detailOf(fuelTurn)).events).toEqual([]);
      expect((await boss.get(`/trip-schedules/${fuelTrip}`)).data.status).toBe('pending');
    });

    it('★ refuses a `fuel` trip line on this lorry; the other headings pass', async () => {
      const fuel = await driverA.post(`/driver/assignments/${fuelTurn}/expenses`, { category: 'fuel', amount: '300000.00' });
      expect(fuel.status).toBe(422);
      expect(toApiError(fuel.status, fuel.data).details).toEqual({ category: 'FUEL_DECLARED_ON_VEHICLE' });

      const toll = await driverA.post(`/driver/assignments/${fuelTurn}/expenses`, { category: 'toll', amount: '120000.00' });
      expect(toll.status).toBe(201);
    });

    it('★ declares with the lorry and the day the SERVER’s — a body naming either changes nothing', async () => {
      expect((await driverA.post(`/driver/assignments/${fuelTurn}/fuel-checks`, { outcome: 'no_fuel' })).status).toBe(422);
      expect(
        (await driverB.post(`/driver/assignments/${fuelTurn}/fuel-checks`, { outcome: 'no_fuel', clientRequestId: 'b' }))
          .status,
      ).toBe(403);

      const body = {
        outcome: 'fuel_added',
        amount: '1250000.00',
        liters: '50.25',
        odometerKm: 182345,
        note: 'Petrolimex',
        clientRequestId: FILL_KEY,
        vehicleId: randomUUID(),
        businessDate: '2020-01-01',
        tripId: randomUUID(),
        sourceTripId: randomUUID(),
        createdBy: randomUUID(),
      };
      const declared = await driverA.post(`/driver/assignments/${fuelTurn}/fuel-checks`, body);
      expect(declared.status).toBe(201);
      expect(declared.data).toEqual({ businessDate: todayAsCalendarDay(), outcome: 'fuel_added' });

      // A retry on a weak signal is answered with the same check, and writes no second fill.
      const retried = await driverA.post(`/driver/assignments/${fuelTurn}/fuel-checks`, body);
      expect(retried.status).toBe(201);
      expect(retried.data).toEqual(declared.data);
    });

    it('★ another driver on another trip of the same lorry is told only that the check stands — no ids', async () => {
      // Driver B holding A's turn id and A's key is refused at the door.
      expect(
        (await driverB.post(`/driver/assignments/${fuelTurn}/fuel-checks`, { outcome: 'no_fuel', clientRequestId: FILL_KEY }))
          .status,
      ).toBe(403);

      const trip = await boss.post('/trip-schedules', {
        scheduledOn: booked.day,
        pickupAddress: `Fuel pickup B ${unique}`,
        deliveryAddress: `Fuel delivery B ${unique}`,
        pickupAt: booked.pickupAt,
        sellPrice: SELL_PRICE,
      });
      expect(trip.status).toBe(201);
      const theirs = await boss.post(`/trip-schedules/${trip.data.id}/driver-assignments`, {
        vehicleId: fuelVehicle,
        driverUserId: driverBUserId,
      });
      expect(theirs.status).toBe(201);

      // B declares "no fuel" with a key of their own: A's fill already answered the
      // lorry's day, so B is told THAT — the day and the outcome, nothing of A's.
      const loser = await driverB.post(`/driver/assignments/${theirs.data.id}/fuel-checks`, {
        outcome: 'no_fuel',
        clientRequestId: `fuel-b-${unique}`,
      });
      expect(loser.status).toBe(201);
      expect(keysOf(loser.data)).toEqual(['businessDate', 'outcome']);
      expect(loser.data).toEqual({ businessDate: todayAsCalendarDay(), outcome: 'fuel_added' });
    });

    it('★ the held milestone, retried with the SAME key, now starts the trip', async () => {
      const started = await arrive();
      expect(started.status).toBe(201);
      expect((await boss.get(`/trip-schedules/${fuelTrip}`)).data.status).toBe('executing');
    });

    it('★ the office reads the fill on the lorry — and the trip’s total never counts it', async () => {
      const day = todayAsCalendarDay();
      const ledger = await boss.get(`/trip-vehicles/${fuelVehicle}/costs`, { params: { from: day, to: day } });
      expect(ledger.status).toBe(200);
      expect(ledger.data).toMatchObject({ total: 1, totalAmount: '1250000.00', page: 1 });
      expect(ledger.data.items[0]).toMatchObject({
        vehicleId: fuelVehicle,
        businessDate: day,
        category: 'fuel',
        amount: '1250000.00',
        liters: '50.25',
        odometerKm: 182345,
        source: 'driver_portal',
        sourceTripId: fuelTrip,
        sourceTrip: { id: fuelTrip, scheduledOn: booked.day, customerName: null },
        sourceAssignmentId: fuelTurn,
      });

      const summary = await boss.get(`/trip-schedules/${fuelTrip}/cost-summary`);
      expect(summary.data.combined).toBe('120000.00');

      // A driver reads no money, the lorry's included.
      expect((await driverA.get(`/trip-vehicles/${fuelVehicle}/costs`)).status).toBe(403);
    });

    // ----------------------------- a fill after the check (fleet operations) --

    const FILL_AFTER = `fill-${unique}`;
    const fillBody = { amount: '300000.00', liters: '12.50', odometerKm: 182400, note: null, clientRequestId: FILL_AFTER };

    it('★ records a fill after the check: one more ledger row, the check untouched, only the driver’s own row back', async () => {
      const filled = await driverA.post(`/driver/assignments/${fuelTurn}/fuel-transactions`, {
        ...fillBody,
        // None of these is the body's to say; each is stripped.
        vehicleId: randomUUID(),
        businessDate: '2020-01-01',
        sourceTripId: randomUUID(),
        source: 'backoffice',
      });
      expect(filled.status).toBe(201);
      expect(keysOf(filled.data)).toEqual(sorted(['id', 'businessDate', 'amount', 'liters', 'odometerKm', 'note', 'createdAt']));
      expect(filled.data).toMatchObject({ businessDate: todayAsCalendarDay(), amount: '300000.00', liters: '12.50', odometerKm: 182400 });

      // The same key and fill is the same row; the same key with another fill is a 409.
      const retried = await driverA.post(`/driver/assignments/${fuelTurn}/fuel-transactions`, fillBody);
      expect([retried.status, retried.data.id]).toEqual([201, filled.data.id]);
      expect((await driverA.post(`/driver/assignments/${fuelTurn}/fuel-transactions`, { ...fillBody, amount: '310000.00' })).status).toBe(409);
      // The declaration's key is never a fill's.
      expect((await driverA.post(`/driver/assignments/${fuelTurn}/fuel-transactions`, { ...fillBody, clientRequestId: FILL_KEY })).status).toBe(409);
      // Another driver holding the turn id is refused at the door.
      expect((await driverB.post(`/driver/assignments/${fuelTurn}/fuel-transactions`, { ...fillBody, clientRequestId: `b-${unique}` })).status).toBe(403);

      const day = todayAsCalendarDay();
      const ledger = await boss.get(`/trip-vehicles/${fuelVehicle}/costs`, { params: { from: day, to: day } });
      expect(ledger.data).toMatchObject({ total: 2, totalAmount: '1550000.00' });
      // No trip line was written: the trip's total is still the toll alone.
      expect((await boss.get(`/trip-schedules/${fuelTrip}/cost-summary`)).data.combined).toBe('120000.00');
    });

    it('★ Ca làm việc hôm nay — the lorry, its fuel answer and the turn, exact keys, no money', async () => {
      const response = await driverA.get('/driver/workday');
      expect(response.status).toBe(200);
      expect(keysOf(response.data)).toEqual(['businessDate', 'vehicles']);
      expect(response.data.businessDate).toBe(todayAsCalendarDay());
      const lorry = response.data.vehicles.find((entry: { vehicle: { id: string } }) => entry.vehicle.id === fuelVehicle);
      expect(keysOf(lorry)).toEqual(['fuel', 'fuelOnVehicle', 'turns', 'vehicle']);
      expect(lorry).toMatchObject({ fuel: 'FUEL_ADDED', fuelOnVehicle: true });
      expect(keysOf(lorry.vehicle)).toEqual(['id', 'plate']);
      const [turn] = lorry.turns;
      expect(keysOf(turn)).toEqual(sorted([...DRIVER_TRIP_KEYS, 'closed', 'progress']));
      expect(turn).toMatchObject({ assignment: { id: fuelTurn }, closed: false, progress: { reached: 1, next: 'PICKUP_CONFIRMED' } });
      expect(JSON.stringify(response.data)).not.toMatch(/1250000|300000|amount|sellPrice|purchasePrice/);
      // Only the caller's own turns: driver B, on another trip of the same lorry, never sees A's turn.
      const theirs = await driverB.get('/driver/workday');
      const theirTurns = theirs.data.vehicles.flatMap((entry: { turns: Array<{ assignment: { id: string } }> }) => entry.turns);
      expect(theirTurns.map((entry: { assignment: { id: string } }) => entry.assignment.id)).not.toContain(fuelTurn);
    });

    it('★ Điều hành xe — the SuperAdmin reads the money, and it reconciles to the đồng with "Chi phí xe"', async () => {
      const day = todayAsCalendarDay();
      const board = await boss.get('/fleet-operations', { params: { date: day } });
      expect(board.status).toBe(200);
      expect(keysOf(board.data)).toEqual(['businessDate', 'summary', 'vehicles', 'withMoney']);
      expect(board.data).toMatchObject({ businessDate: day, withMoney: true });
      expect(keysOf(board.data.summary)).toEqual(['fuelMissing', 'running', 'total', 'unassigned', 'waiting']);

      const row = board.data.vehicles.find((entry: { vehicle: { id: string } }) => entry.vehicle.id === fuelVehicle);
      expect(keysOf(row)).toEqual(['currentAssignmentId', 'drivers', 'fuel', 'nextAssignmentId', 'state', 'turns', 'vehicle']);
      expect(keysOf(row.fuel)).toEqual(['check', 'fills', 'issues', 'obligation', 'totalAmount']);
      expect(row).toMatchObject({
        state: 'running',
        fuel: { obligation: 'FUEL_ADDED', fills: 2, totalAmount: '1550000.00', issues: [], check: { outcome: 'fuel_added', amount: '1250000.00' } },
      });
      const ledger = await boss.get(`/trip-vehicles/${fuelVehicle}/costs`, { params: { from: day, to: day } });
      expect(row.fuel.totalAmount).toBe(ledger.data.totalAmount);

      // A driver is not a reader of the board at all.
      expect((await driverA.get('/fleet-operations')).status).toBe(403);
      expect((await boss.get('/fleet-operations', { params: { date: 'today' } })).status).toBe(422);
    });

    /**
     * ★ WHO MAY READ THE BOARD — real departments with real functions, real
     * heads and members, real sign-ins: the authorization the server loads
     * from PostgreSQL, not a mocked context. `dispatch.write` (global or the
     * dispatch function); never Sales, Accounting or Customer Service — who
     * still read Lịch xe — and never a unit with no function.
     */
    describe('★ Điều hành xe — who may read it, against the real API', () => {
      const staff: Record<string, Client> = {};

      const department = async (fn: string | null) => {
        const created = await boss.post('/departments', { slug: `fleet-${fn ?? 'none'}-${unique}`, name: `Fleet ${fn ?? 'none'} ${unique}`, function: fn });
        expect(created.status).toBe(201);
        return created.data.id as string;
      };
      const employee = async (label: string, departmentId: string, head: boolean) => {
        const email = `fleet-${label}-${unique}@hoanglonglti.com`;
        const created = await boss.post('/users', { displayName: `Fleet ${label} ${unique}`, email, initialPassword: TEMPORARY_STAFF, departmentId });
        expect(created.status).toBe(201);
        if (head) expect((await boss.post(`/departments/${departmentId}/head`, { userId: created.data.id })).status).toBe(201);
        const setup = makeClient();
        expect((await login(setup, email, TEMPORARY_STAFF)).status).toBe(200);
        expect((await setup.post('/auth/password', { currentPassword: TEMPORARY_STAFF, newPassword: CHOSEN_STAFF })).status).toBe(204);
        const client = makeClient();
        expect((await login(client, email, CHOSEN_STAFF)).status).toBe(200);
        staff[label] = client;
      };

      beforeAll(async () => {
        for (const fn of ['dispatch', 'sales', 'customer_service', 'accounting', null] as const) {
          const unit = await department(fn);
          const name = fn ?? 'none';
          await employee(`${name}-head`, unit, true);
          await employee(`${name}-member`, unit, false);
        }
      });

      it.each(['dispatch-head', 'dispatch-member'])('★ %s reads the board — every fact but the money', async (label) => {
        const board = await staff[label]!.get('/fleet-operations');
        expect(board.status).toBe(200);
        expect(board.data.withMoney).toBe(false);
        const row = board.data.vehicles.find((entry: { vehicle: { id: string } }) => entry.vehicle.id === fuelVehicle);
        expect(row.fuel).toMatchObject({ obligation: 'FUEL_ADDED', fills: 2, totalAmount: null, check: { outcome: 'fuel_added', amount: null } });
        expect(JSON.stringify(board.data)).not.toMatch(/1250000|1550000|300000\.00/);
        // ★ And no new money route: the lorry's ledger stays cost.read.
        expect((await staff[label]!.get(`/trip-vehicles/${fuelVehicle}/costs`)).status).toBe(403);
      });

      it.each([
        'sales-head', 'sales-member', 'customer_service-head', 'customer_service-member',
        'accounting-head', 'accounting-member', 'none-head', 'none-member',
      ])('★ %s is refused the board (403) — whatever they read on Lịch xe', async (label) => {
        const board = await staff[label]!.get('/fleet-operations');
        expect([label, board.status, toApiError(board.status, board.data).code]).toEqual([label, 403, 'FORBIDDEN']);
      });

      it('★ the boundary is the board, not the trips: the booking functions still read Lịch xe; a unit with none does not', async () => {
        for (const label of ['sales-member', 'customer_service-member', 'accounting-member', 'dispatch-member']) {
          expect([label, (await staff[label]!.get('/trip-schedules')).status]).toEqual([label, 200]);
        }
        expect((await staff['none-member']!.get('/trip-schedules')).status).toBe(403);
      });
    });
  });
  describe('★ open bookings — the driver asks, Dispatch assigns (0035)', () => {
    /** Exactly what a driver may see of a booking that is not theirs. */
    const OPEN_BOOKING_KEYS = [
      'cargoInfo', 'delivery', 'driverInstructions', 'myPendingRequestId', 'pickup',
      'scheduledDeliveryAt', 'scheduledOn', 'scheduledPickupAt', 'tripId',
    ];
    let openTrip: string;
    const listedFor = async (driver: Client) => {
      const listed = await driver.get('/driver/open-bookings');
      expect(listed.status).toBe(200);
      return listed.data as Array<{ tripId: string; myPendingRequestId: string | null }>;
    };

    beforeAll(async () => {
      // Priced, with a customer and two places — every figure below must stay out of a driver's reach.
      openTrip = await walkableBooking();
    });

    it('★ shows the booking to every driver — the safe projection only: no price, customer, contact', async () => {
      const item = (await listedFor(driverA)).find((booking) => booking.tripId === openTrip);
      expect(item).toBeDefined();
      expect(keysOf(item as object)).toEqual(sorted(OPEN_BOOKING_KEYS));
      const wire = JSON.stringify(item);
      for (const secret of [SELL_PRICE, `Journey Customer ${unique}`, `Journey address ${unique}`]) {
        expect([secret, wire.includes(secret)]).toEqual([secret, false]);
      }
      expect((await listedFor(driverB)).some((booking) => booking.tripId === openTrip)).toBe(true);
    });

    it('★ one ask however often it is tapped; the review is dispatch.write only', async () => {
      const [first, second] = await Promise.all([
        driverA.post(`/driver/open-bookings/${openTrip}/requests`, {}),
        driverA.post(`/driver/open-bookings/${openTrip}/requests`, {}),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(second.data.id).toBe(first.data.id);
      expect(first.data).toMatchObject({ state: 'pending', assignmentId: null, booking: { tripId: openTrip } });
      expect((await driverB.post(`/driver/open-bookings/${openTrip}/requests`, {})).status).toBe(201);
      expect((await listedFor(driverA)).find((booking) => booking.tripId === openTrip)?.myPendingRequestId).toBe(first.data.id);

      const queue = await boss.get('/assignment-request-queue');
      expect(queue.status).toBe(200);
      expect(queue.data.filter((ask: { tripId: string }) => ask.tripId === openTrip)).toHaveLength(2);
      expect((await driverA.get('/assignment-request-queue')).status).toBe(403);
      expect((await driverA.get(`/trip-schedules/${openTrip}/assignment-requests`)).status).toBe(403);
    });

    it('★ approval needs a lorry, crews the asking driver, and closes the other driver’s ask', async () => {
      const asks = await boss.get(`/trip-schedules/${openTrip}/assignment-requests`);
      const mine = asks.data.find((ask: { driver: { id: string } }) => ask.driver.id === driverAId);
      const approvePath = `/trip-schedules/${openTrip}/assignment-requests/${mine.id}/approve`;

      expect((await boss.post(approvePath, {})).status).toBe(422);
      const vehicle = await boss.post('/trip-vehicles', { plate: `OB-${unique}` });
      expect(vehicle.status).toBe(201);
      const approved = await boss.post(approvePath, { vehicleId: vehicle.data.id });
      expect(approved.status).toBe(200);
      expect(approved.data).toMatchObject({ state: 'approved', driverUserId: driverAId });

      // Driver A: the trip is in "Chuyến của tôi" through the EXISTING read model — still no money.
      const schedule = await driverA.get('/driver/assignments');
      const turn = schedule.data.find((row: { tripId: string }) => row.tripId === openTrip);
      expect(keysOf(turn)).toEqual(sorted(DRIVER_TRIP_KEYS));
      expect(JSON.stringify(schedule.data)).not.toContain(SELL_PRICE);
      const mineNow = (await driverA.get('/driver/assignment-requests')).data.find(
        (ask: { id: string }) => ask.id === mine.id,
      );
      expect(mineNow).toMatchObject({ state: 'approved', assignmentId: turn.assignment.id });

      // Driver B: told, superseded — and the trip is still not theirs to open.
      const theirs = (await driverB.get('/driver/assignment-requests')).data.find(
        (ask: { booking: { tripId: string } }) => ask.booking.tripId === openTrip,
      );
      expect(theirs).toMatchObject({ state: 'superseded', supersededBecause: 'trip_assigned' });
      const told = await driverB.get('/notifications');
      expect(
        told.data.items.some(
          (row: { type: string; tripId: string }) => row.type === 'ASSIGNMENT_REQUEST_SUPERSEDED' && row.tripId === openTrip,
        ),
      ).toBe(true);
      expect((await driverB.get(`/driver/assignments/${turn.assignment.id}`)).status).toBe(403);
      expect((await listedFor(driverB)).some((booking) => booking.tripId === openTrip)).toBe(false);
    });
  });
});
