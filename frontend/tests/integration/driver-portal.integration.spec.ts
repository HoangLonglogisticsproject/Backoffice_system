import { randomBytes, randomUUID } from 'node:crypto';
import axios, { AxiosHeaders, type AxiosInstance } from 'axios';
import { beforeAll, describe, expect, it } from 'vitest';
import { toApiError } from '@/utils/errors';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@/api/client';
import type { DriverTripDetail } from '@/types/driver';
import { assignmentStatusOf } from '@/utils/driverExecution';
import { scheduleViewOf } from '@/utils/driverSchedule';
import { todayAsCalendarDay } from '@/utils/format/datetime';
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
const DETAIL_KEYS = [...DRIVER_TRIP_KEYS, 'events', 'expenses', 'accountability', 'completion'];
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

/** `Date.toJSON` — the ONLY stamp shape the portal's string comparisons are safe on. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('driver portal (D1) against the real API', () => {
  const unique = randomBytes(4).toString('hex');
  const today = todayAsCalendarDay();
  /** 08:00 on the business calendar, so the expected UTC instant is exact. */
  const pickupAt = `${today}T08:00:00+07:00`;
  const SELL_PRICE = '4500000.00';
  const customerName = `Driver Portal Customer ${unique}`;

  let boss: Client;
  let driverA: Client;
  let driverAId: string;
  let driverB: Client;
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
      scheduledOn: today,
      customerId: customer.data.id,
      pickupAddress: `Pickup ${unique}`,
      deliveryAddress: `Delivery ${unique}`,
      pickupAt,
      sellPrice: SELL_PRICE,
    });
    expect(trip.status).toBe(201);
    tripId = trip.data.id;

    untouchedId = await assignLorry(driverAId);
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
    it('lists the new turn with exactly the DriverTrip fields, on TODAY', async () => {
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
        scheduledOn: today,
        vehicle: { id: expect.any(String), plate: `DP-${unique}-1` },
        customer: { id: expect.any(String), name: customerName },
        pickupAddress: `Pickup ${unique}`,
        deliveryAddress: `Delivery ${unique}`,
        scheduledPickupAt: new Date(pickupAt).toISOString(),
        assignment: { id: untouchedId, assignedAt: expect.stringMatching(ISO_UTC) },
      });
      // ★ The day is TEXT, not an instant — `scheduleViewOf` compares it as a string.
      expect(item.scheduledOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(scheduleViewOf(item.scheduledOn, todayAsCalendarDay())).toBe('today');
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
        scheduledOn: today,
        assignment: { id: untouchedId },
        events: [],
        expenses: [],
        accountability: 'NOT_DECLARED',
        completion: null,
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

    it('★ a completion sent BEFORE the journey is finished is accepted, and outranks it — "completion-pending"', async () => {
      const assignmentId = await assignLorry(driverAId);

      expect(
        (
          await driverA.post(`/driver/assignments/${assignmentId}/execution-events`, {
            type: 'ARRIVED_PICKUP',
            deviceReportedAt: new Date().toISOString(),
            clientEventId: `${assignmentId}:ARRIVED_PICKUP`,
          })
        ).status,
      ).toBe(201);
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

      // Three events still owed. The server does not refuse this on purpose: a
      // driver who lost signal at the gate must still be able to close out.
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
});
