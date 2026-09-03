import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The SHAPE of 0022, without a database. Same job and limit as the other
 * schema specs: the file says the right thing; the integration suite proves
 * PostgreSQL agrees.
 */
const FILE = join(__dirname, '..', '..', 'migrations', '0022_trip_locations.sql');

let source: string;
let body: string;

beforeAll(async () => {
  source = await readFile(FILE, 'utf8');
  body = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
});

describe('0022 — a customer’s places', () => {
  it('★ belongs to exactly one customer, and cannot exist without one', () => {
    expect(body).toContain('customer_id UUID NOT NULL REFERENCES trip_customers(id)');
  });

  it('normalises the name the way 0011 normalises a customer’s, and keeps it unique per customer while active', () => {
    expect(body).toContain("name_key TEXT GENERATED ALWAYS AS (upper(trim(regexp_replace(name, '\\s+', ' ', 'g')))) STORED");
    expect(body).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_location_name ON trip_locations (customer_id, name_key) WHERE status = 'active'",
    );
  });

  it('★ keeps coordinates optional, both-or-neither, and on Earth — the 0019 rule', () => {
    expect(body).toContain('latitude DOUBLE PRECISION, longitude DOUBLE PRECISION');
    expect(body).not.toMatch(/latitude DOUBLE PRECISION NOT NULL/);
    expect(body).toContain('(latitude IS NULL) = (longitude IS NULL)');
    expect(body).toContain('latitude BETWEEN -90 AND 90');
    expect(body).toContain('longitude BETWEEN -180 AND 180');
  });

  it('requires a name and an address, and nothing else', () => {
    expect(body).toContain('name TEXT NOT NULL CHECK (length(trim(name)) > 0)');
    expect(body).toContain('address TEXT NOT NULL CHECK (length(trim(address)) > 0)');
    expect(body).toContain('contact TEXT,');
  });

  it('archives rather than deletes — T3 by the function 0017 defined', () => {
    expect(body).toContain("status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'))");
    expect(body).toContain('CREATE TRIGGER trip_locations_deny_delete BEFORE DELETE ON trip_locations');
    expect(body).toContain('DROP TRIGGER IF EXISTS trip_locations_deny_delete');
  });

  it('★ adds only PROVENANCE to the trip, nullable, and touches no 0019 column', () => {
    expect(body).toContain('ADD COLUMN IF NOT EXISTS pickup_location_id UUID REFERENCES trip_locations(id)');
    expect(body).toContain('ADD COLUMN IF NOT EXISTS delivery_location_id UUID REFERENCES trip_locations(id)');
    expect(body).not.toMatch(/pickup_latitude|pickup_longitude|delivery_latitude|delivery_longitude/);
    expect(body).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });

  it('backfills nothing: existing trips keep their typed snapshot and no place is invented', () => {
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(body).not.toMatch(/\bUPDATE\s+trip_schedules\b/i);
  });

  it('is guarded so a re-run cannot break a deploy', () => {
    const creates = [...source.matchAll(/CREATE (TABLE|INDEX|UNIQUE INDEX)\b/g)].length;
    const guarded = [...source.matchAll(/CREATE (?:TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS/g)].length;
    expect(guarded).toBe(creates);
    const created = [...source.matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]);
    const dropped = new Set([...source.matchAll(/DROP TRIGGER IF EXISTS (\w+)/g)].map((m) => m[1]));
    for (const name of created) expect([name, dropped.has(name)]).toEqual([name, true]);
  });
});
