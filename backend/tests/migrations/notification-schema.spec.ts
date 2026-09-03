import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The SHAPE of 0020, without a database. Same job and same limit as the other
 * schema specs: it proves the file says the right thing, and the integration
 * suite proves PostgreSQL agrees.
 */
const FILE = join(__dirname, '..', '..', 'migrations', '0020_notifications.sql');

let source: string;
let body: string;

beforeAll(async () => {
  source = await readFile(FILE, 'utf8');
  body = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
});

describe('0020 — notifications', () => {
  it('is one table with a recipient, a type, a trip and a read stamp', () => {
    expect(body).toContain('CREATE TABLE IF NOT EXISTS notifications');
    expect(body).toContain('recipient_user_id UUID NOT NULL REFERENCES users(id)');
    expect(body).toContain('trip_id UUID NOT NULL REFERENCES trip_schedules(id)');
    expect(body).toContain('read_at TIMESTAMPTZ');
  });

  it('★ is idempotent per recipient and business event, in the database', () => {
    expect(body).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_event ON notifications (recipient_user_id, event_key)',
    );
  });

  it('has exactly the four driver-facing event types', () => {
    const list = body.match(/type TEXT NOT NULL CHECK \(type IN \(([^)]+)\)\)/)?.[1] ?? '';
    const types = [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(types).toEqual([
      'TRIP_ASSIGNED',
      'TRIP_UNASSIGNED',
      'COMPLETION_REJECTED',
      'COMPLETION_APPROVED',
    ]);
  });

  it('★ carries no money and no free text but a reason', () => {
    // No amount, no price, no JSON blob a row could be poured into.
    expect(body).not.toMatch(/NUMERIC|JSONB|amount|price|fee/i);
    expect(body).toContain('detail TEXT');
  });

  it('cannot be deleted — T3, by the function 0017 defined', () => {
    expect(body).toContain('CREATE TRIGGER notifications_deny_delete BEFORE DELETE ON notifications');
    expect(body).toContain('EXECUTE FUNCTION deny_delete()');
    expect(body).toContain('DROP TRIGGER IF EXISTS notifications_deny_delete');
  });

  it('is guarded so a re-run cannot break a deploy, and seeds nothing', () => {
    const creates = [...source.matchAll(/CREATE (TABLE|INDEX|UNIQUE INDEX)\b/g)].length;
    const guarded = [...source.matchAll(/CREATE (?:TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS/g)].length;
    expect(guarded).toBe(creates);
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(body).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });
});
