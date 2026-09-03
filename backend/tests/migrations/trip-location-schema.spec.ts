import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Asserts the SHAPE of 0019 without a database — the same job, and the same
 * limit, as `trip-operational-schema.spec.ts` for 0013–0017.
 *
 * What this exists to catch: a range that is only in the DTO, a pair that can
 * be half-written, a backfill that invents a location for every trip, and a
 * GPS log that was never asked for.
 */
const FILE = join(__dirname, '..', '..', 'migrations', '0019_trip_location.sql');

let source: string;
/** `--` comments stripped, whitespace flattened. The prose argues against things it does not do. */
let body: string;

beforeAll(async () => {
  source = await readFile(FILE, 'utf8');
  body = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
});

describe('0019 — destination coordinates and milestone location evidence', () => {
  it('adds both pairs to trip_schedules, nullable, with no default', () => {
    for (const column of ['pickup_latitude', 'pickup_longitude', 'delivery_latitude', 'delivery_longitude']) {
      expect(body).toContain(`ADD COLUMN IF NOT EXISTS ${column} DOUBLE PRECISION`);
      expect(body).not.toMatch(new RegExp(`${column} DOUBLE PRECISION[^,;]*(NOT NULL|DEFAULT)`, 'i'));
    }
  });

  it('★ backfills nothing: no trip is given a location by the migration', () => {
    expect(body).not.toMatch(/\bUPDATE\s+trip_schedules\b/i);
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/i);
  });

  it('★ refuses half a point, in the database', () => {
    expect(body).toContain('(pickup_latitude IS NULL) = (pickup_longitude IS NULL)');
    expect(body).toContain('(delivery_latitude IS NULL) = (delivery_longitude IS NULL)');
  });

  it('bounds every axis where a script cannot skip it', () => {
    expect(body).toContain('pickup_latitude BETWEEN -90 AND 90');
    expect(body).toContain('pickup_longitude BETWEEN -180 AND 180');
    expect(body).toContain('delivery_latitude BETWEEN -90 AND 90');
    expect(body).toContain('delivery_longitude BETWEEN -180 AND 180');
    expect(body).toContain('latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180');
  });

  it('keeps the reading, its accuracy, its capture time and the server’s verdict beside the event', () => {
    for (const column of ['latitude', 'longitude', 'accuracy_m', 'location_captured_at', 'geofence_passed', 'distance_m']) {
      expect(body).toMatch(new RegExp(`ALTER TABLE trip_execution_events[^;]*ADD COLUMN IF NOT EXISTS ${column} `));
    }
  });

  it('★ makes the reading move as one and the verdict imply a reading', () => {
    expect(body).toContain('latitude IS NULL AND longitude IS NULL AND accuracy_m IS NULL');
    expect(body).toContain('(geofence_passed IS NULL) = (distance_m IS NULL)');
    expect(body).toContain('accuracy_m >= 0');
  });

  it('★ bounds accuracy and distance from ABOVE too, because NaN and Infinity pass `>= 0`', () => {
    // PostgreSQL sorts NaN above every float, Infinity included, so a
    // one-sided check lets both through. The BETWEENs on the axes already
    // carry an upper bound; these two must spell it out.
    expect(body).toContain("accuracy_m >= 0 AND accuracy_m < 'Infinity'::DOUBLE PRECISION");
    expect(body).toContain("distance_m >= 0 AND distance_m < 'Infinity'::DOUBLE PRECISION");
  });

  it('adds every constraint plainly — the runner’s one-transaction-per-file makes NOT VALID moot', () => {
    expect(body).not.toMatch(/NOT VALID/i);
    expect(body).not.toMatch(/VALIDATE CONSTRAINT/i);
  });

  it('★ creates no location-history table: evidence lives on the milestone, never as a track', () => {
    expect(body).not.toMatch(/CREATE TABLE/i);
  });

  it('drops every constraint before adding it, so ALTER can run twice', () => {
    const added = [...source.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]);
    const dropped = new Set([...source.matchAll(/DROP CONSTRAINT IF EXISTS (\w+)/g)].map((m) => m[1]));
    expect(added.length).toBeGreaterThan(0);
    for (const name of added) expect([name, dropped.has(name)]).toEqual([name, true]);
  });

  it('never DROPs a column or a table: forward-only means additive', () => {
    expect(body).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });
});
