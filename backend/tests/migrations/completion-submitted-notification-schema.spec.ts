import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The SHAPE of 0036, without a database. Same job and same limit as every other
 * schema spec: it proves the file says the right thing, and the integration
 * suite proves PostgreSQL agrees.
 */
const FILE = join(__dirname, '..', '..', 'migrations', '0036_completion_submitted_notification.sql');

let source: string;
let body: string;

beforeAll(async () => {
  source = await readFile(FILE, 'utf8');
  body = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
});

describe('0036 — the completion a reviewer is told about', () => {
  it('★ keeps every type that already existed and adds exactly one', () => {
    const list = body.match(/CHECK \(type IN \(([^)]+)\)\)/)?.[1] ?? '';
    const types = [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

    // The order is 0020's, then 0035's, then this one — a re-add that dropped a
    // word would make rows of that type unwritable without any migration saying so.
    expect(types).toEqual([
      'TRIP_ASSIGNED',
      'TRIP_UNASSIGNED',
      'COMPLETION_REJECTED',
      'COMPLETION_APPROVED',
      'ASSIGNMENT_REQUEST_REJECTED',
      'ASSIGNMENT_REQUEST_SUPERSEDED',
      'COMPLETION_SUBMITTED',
    ]);
  });

  it('is re-runnable: the constraint is dropped by name before it is added', () => {
    expect(body).toContain('ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check');
    expect(body).toContain('ADD CONSTRAINT notifications_type_check');
  });

  it('★ adds no table, no column and no row — the recipient is just a user', () => {
    expect(body).not.toMatch(/CREATE TABLE|ADD COLUMN|CREATE INDEX/i);
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(body).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });

  it('★ carries nothing commercial, as 0020 requires of this table', () => {
    expect(body).not.toMatch(/NUMERIC|JSONB|amount|price|fee/i);
  });
});
