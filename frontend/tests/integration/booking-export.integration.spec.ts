import { randomBytes } from 'node:crypto';
import axios, { AxiosHeaders, type AxiosInstance } from 'axios';
import { beforeAll, describe, expect, it } from 'vitest';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@/api/client';
import type { BookingExport } from '@/types/bookingExport';
import { businessInstant, todayAsCalendarDay } from '@/utils/format/datetime';
import { BASE_URL, fixturePassword, requireBossCredentials } from '../helpers/integration-credentials';

/**
 * "Tải booking PNG" against a REAL backend and PostgreSQL (contract §30).
 *
 * ★ WHAT ONLY A REAL STACK CAN SAY: that every booking function, signed in
 * through real departments and the authorization the server loads, receives
 * the SAME document for the same trip — and that the trip's price and internal
 * note, which the SuperAdmin can read on the board, are not in it for anybody.
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
    if (!['get', 'head', 'options'].includes(method)) config.headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
    if (client.cookie) config.headers.set('Cookie', client.cookie);
    return config;
  });
  client.interceptors.response.use((response) => {
    const setCookie = response.headers['set-cookie'];
    const session = Array.isArray(setCookie) ? setCookie.find((c) => c.startsWith('bo_session=')) : undefined;
    if (session) {
      const value = session.split(';')[0];
      client.cookie = value.endsWith('=') ? null : value;
    }
    return response;
  });
  return client;
}

const login = (client: Client, email: string, password: string) => client.post('/auth/login', { subject: email, password });

/** The contract's keys, as EXACT sets: a missing one is a blank on the document, an extra one is the allowlist growing. */
const EXPORT_KEYS = [
  'cargoInfo', 'crew', 'customerName', 'delivery', 'driverInstructions', 'pickup',
  'scheduledDeliveryAt', 'scheduledOn', 'scheduledPickupAt',
];
const keysOf = (value: object) => Object.keys(value).sort();

const TEMPORARY = fixturePassword('export-temporary');
const CHOSEN = fixturePassword('export-chosen');
const SELL_PRICE = '4500000.00';
const INTERNAL_NOTE = 'giá chốt nội bộ — thu sau 30 ngày';

/** Tomorrow 08:00 on the business calendar — a booking any clock accepts. */
const tomorrowAtEight = (): { day: string; pickupAt: string } => {
  const day = new Date(Date.parse(`${todayAsCalendarDay()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { day, pickupAt: businessInstant(day, '08:00') };
};

describe('booking export against the real API', () => {
  const unique = randomBytes(4).toString('hex');
  const staff: Record<string, Client> = {};
  let boss: Client;
  let driver: Client;
  let tripId: string;

  /** A signed-in account past the temporary-credential gate. */
  const signedIn = async (email: string): Promise<Client> => {
    const setup = makeClient();
    expect((await login(setup, email, TEMPORARY)).status).toBe(200);
    expect((await setup.post('/auth/password', { currentPassword: TEMPORARY, newPassword: CHOSEN })).status).toBe(204);
    const client = makeClient();
    expect((await login(client, email, CHOSEN)).status).toBe(200);
    return client;
  };

  beforeAll(async () => {
    const credentials = requireBossCredentials();
    boss = makeClient();
    if ((await login(boss, credentials.email, credentials.password)).status !== 200) {
      throw new Error(`Could not sign in as ${credentials.email}. Bootstrap a SuperAdmin first.`);
    }

    const driverEmail = `bx-driver-${unique}@hoanglonglti.com`;
    const created = await boss.post('/driver-accounts', { displayName: `Tài xế ${unique}`, email: driverEmail, initialPassword: TEMPORARY });
    expect(created.status).toBe(201);
    driver = await signedIn(driverEmail);

    const customer = await boss.post('/trip-customers', { name: `Khách xuất booking ${unique}` });
    expect(customer.status).toBe(201);
    const place = async (name: string) => {
      const made = await boss.post(`/trip-customers/${customer.data.id}/locations`, {
        name: `${name} ${unique}`,
        address: `Lô B2-7, Đường số 12, KCN Tân Phú Trung, Củ Chi, TP. Hồ Chí Minh ${unique}`,
        contact: 'Anh Tuấn — 0909 123 456',
      });
      expect(made.status).toBe(201);
      return made.data.id as string;
    };
    const { day, pickupAt } = tomorrowAtEight();
    const trip = await boss.post('/trip-schedules', {
      scheduledOn: day,
      pickupAt,
      customerId: customer.data.id,
      pickupLocationId: await place('Kho Củ Chi'),
      deliveryLocationId: await place('Cửa hàng Q1'),
      cargoInfo: '24 kiện · 1.2 tấn · 6 CBM',
      note: INTERNAL_NOTE,
      sellPrice: SELL_PRICE,
      entryMode: 'operational',
    });
    expect(trip.status).toBe(201);
    tripId = trip.data.id;

    const vehicle = await boss.post('/trip-vehicles', { plate: `BX-${unique}` });
    expect(vehicle.status).toBe(201);
    const assigned = await boss.post(`/trip-schedules/${tripId}/driver-assignments`, {
      vehicleId: vehicle.data.id,
      driverUserId: created.data.userId,
    });
    expect(assigned.status).toBe(201);

    for (const fn of ['dispatch', 'sales', 'customer_service', 'accounting', null] as const) {
      const name = fn ?? 'none';
      const unit = await boss.post('/departments', { slug: `bx-${name}-${unique}`, name: `Booking export ${name} ${unique}`, function: fn });
      expect(unit.status).toBe(201);
      const email = `bx-${name}-${unique}@hoanglonglti.com`;
      const user = await boss.post('/users', { displayName: `Export ${name} ${unique}`, email, initialPassword: TEMPORARY, departmentId: unit.data.id });
      expect(user.status).toBe(201);
      staff[name] = await signedIn(email);
    }
  });

  const exportFor = (client: Client, trip = tripId) => client.get(`/trip-schedules/${trip}/booking-export`);

  it('★ the SuperAdmin gets the fixed contract — and not the price or the internal note they can read on the board', async () => {
    const response = await exportFor(boss);
    expect(response.status).toBe(200);
    const booking = response.data as BookingExport;
    expect(keysOf(booking)).toEqual(EXPORT_KEYS);
    expect(keysOf(booking.pickup)).toEqual(['address', 'contact', 'name']);
    expect(booking.crew).toEqual([{ plate: `BX-${unique}`, driverName: `Tài xế ${unique}` }]);
    expect(booking.pickup.contact).toBe('Anh Tuấn — 0909 123 456');

    const board = await boss.get(`/trip-schedules/${tripId}`);
    expect(board.data.sellPrice).toBe(SELL_PRICE);
    expect(JSON.stringify(booking)).not.toMatch(/4500000|giá chốt nội bộ/);
  });

  it('★ Dispatch, Sales, Customer Service and Accounting get the SAME document, byte for byte', async () => {
    const reference = JSON.stringify((await exportFor(boss)).data);
    for (const fn of ['dispatch', 'sales', 'customer_service', 'accounting']) {
      const response = await exportFor(staff[fn]!);
      expect([fn, response.status, JSON.stringify(response.data)]).toEqual([fn, 200, reference]);
    }
  });

  it('★ a driver, a unit with no booking function and an anonymous caller are refused', async () => {
    expect((await exportFor(driver)).status).toBe(403);
    expect((await exportFor(staff['none']!)).status).toBe(403);
    expect((await exportFor(makeClient())).status).toBe(401);
  });

  it('an unknown trip is 404, a malformed id 422', async () => {
    expect((await exportFor(boss, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await exportFor(boss, 'not-a-trip')).status).toBe(422);
  });
});
