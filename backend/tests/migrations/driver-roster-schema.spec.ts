import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Asserts the SHAPE of 0022, without a database.
 *
 * Same job and same limit as its neighbours: this proves the file SAYS the right
 * thing, not that PostgreSQL agrees. What it is here to catch is the one class
 * of mistake an index-only migration can still make — quietly doing something
 * other than adding an index.
 *
 * ★ 0022 REVERSES A DECISION 0018 WROTE DOWN, which is exactly the kind of
 * change that gets undone by accident later. The cases below pin both halves:
 * the index on `users.account_type` now exists, and the PARTIAL index 0014 built
 * for the live read is still there beside the new full one rather than replaced
 * by it.
 */
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

describe('0022 — the driver roster indexes', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0022_driver_roster_indexes.sql'), 'utf8');
  });

  const normalized = () => sql.replace(/\s+/g, ' ');

  /**
   * ★ AND THE `DROP` HALF IS WHAT KEEPS 0014's PARTIAL INDEX ALIVE. That index is
   * smaller and still serves the far more frequent question — "what is this
   * driver on right now" — so the two coexist. A file that added one index and
   * dropped another would read as a replacement, which this is not.
   */
  it('★ adds indexes and NOTHING else — no table, no column, no data', () => {
    // An index migration is safe to run on a live deployment precisely because
    // it changes nothing readable. The moment it also ALTERs something, that
    // stops being true and nobody re-reads the file to find out.
    const statements = sql.replace(/--[^\n]*/g, '');

    expect(statements).not.toMatch(/CREATE TABLE/i);
    expect(statements).not.toMatch(/ALTER TABLE/i);
    expect(statements).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP)\b/i);
  });

  it('is idempotent, so it can run twice without breaking a deploy', () => {
    const creates = [...sql.matchAll(/CREATE INDEX/g)].length;
    const guarded = [...sql.matchAll(/CREATE INDEX IF NOT EXISTS/g)].length;

    expect(creates).toBeGreaterThan(0);
    expect(guarded).toBe(creates);
  });

  it('★ indexes users by account type IN THE ORDER THE KEYSET READS', () => {
    // The tiebreaker is in the index because `created_at` is not unique:
    // provisioning several accounts in one transaction stamps them identically,
    // and a page boundary inside such a tie loses rows without it.
    expect(normalized()).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_users_account_type_page ON users \(account_type, created_at DESC, id DESC\)/i,
    );
  });

  it('★ indexes a driver’s assignments WITHOUT a state predicate', () => {
    const history = normalized().match(
      /CREATE INDEX IF NOT EXISTS idx_trip_driver_assignment_driver_history ON trip_driver_assignments \([^)]*\)[^;]*/i,
    )?.[0];

    expect(history).toBeDefined();
    expect(history).toMatch(/\(driver_user_id, assigned_at DESC, id DESC\)/i);
    // ⚠ A `WHERE state = 'active'` here would make this a duplicate of 0014's
    // index and leave the history read — the whole reason the file exists —
    // scanning the table.
    expect(history).not.toMatch(/WHERE/i);
  });
});
