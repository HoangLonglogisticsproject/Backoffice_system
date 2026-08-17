import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Asserts the SHAPE of the identity migration without a database.
 *
 * This is not a substitute for running it against PostgreSQL — that is the
 * integration test, and it is currently blocked. What this catches is the
 * class of mistake that survives review and only shows up as a security hole:
 * a missing unique constraint, a foreign key that does not cascade, a token
 * column with no uniqueness.
 */
describe('0001_identity.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(__dirname, '0001_identity.sql'), 'utf8');
  });

  const normalized = () => sql.replace(/\s+/g, ' ');

  it('creates exactly the three identity tables and nothing else', async () => {
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(['identities', 'sessions', 'users']);
  });

  it('creates no table Phase 1 has no business creating', () => {
    // Checks what is CREATED, not what the file mentions: the header comment
    // names these tables precisely to say they are not here yet, and a check
    // that trips over its own documentation is a check people delete.
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);

    for (const premature of [
      'departments',
      'organizational_units',
      'memberships',
      'roles',
      'permissions',
      'role_permissions',
      'capabilities',
      'audit_logs',
    ]) {
      expect(created).not.toContain(premature);
    }
  });

  it('is idempotent, so it can run twice without breaking a deploy', () => {
    const creates = [...sql.matchAll(/CREATE (TABLE|INDEX)/g)].length;
    const guarded = [...sql.matchAll(/CREATE (?:TABLE|INDEX) IF NOT EXISTS/g)].length;
    expect(guarded).toBe(creates);
  });

  it('makes a subject unique per provider — the constraint that stops duplicate accounts', () => {
    expect(normalized()).toContain('UNIQUE (provider, subject)');
  });

  it('makes a session token hash unique', () => {
    expect(normalized()).toContain('UNIQUE (token_hash)');
  });

  it('cascades credentials and sessions from the user that owns them', () => {
    const cascades = [...sql.matchAll(/REFERENCES users\(id\) ON DELETE CASCADE/g)];
    expect(cascades).toHaveLength(2);
  });

  it('constrains user status instead of trusting the application', () => {
    expect(normalized()).toContain("CHECK (status IN ('active', 'disabled'))");
  });

  it('stores a hash column for sessions, never a token column', () => {
    expect(sql).toContain('token_hash');

    /**
     * Any column whose name ENDS in `token`, of any type.
     *
     * The previous form was `/^\s*token\s+TEXT/`, which only caught a column
     * literally called `token` and only when declared TEXT. `session_token
     * VARCHAR(64)` or `access_token BYTEA` — the shapes someone would actually
     * write — both walked straight past it. A security check that only
     * recognises one spelling of the mistake is not a security check.
     *
     * `token_hash` is unaffected: the name must END there, and `_hash` follows.
     */
    const plaintextTokenColumn = /^\s*"?(?:\w+_)?token"?\s+\w/im;

    expect(sql).not.toMatch(plaintextTokenColumn);

    // And the pattern really does catch what it claims to, rather than passing
    // because it matches nothing at all.
    expect('  session_token VARCHAR(64) NOT NULL').toMatch(plaintextTokenColumn);
    expect('  access_token BYTEA').toMatch(plaintextTokenColumn);
    expect('  token UUID').toMatch(plaintextTokenColumn);
    expect('  token_hash  TEXT        NOT NULL').not.toMatch(plaintextTokenColumn);
  });

  it('seeds no data — a user is data, not schema', () => {
    expect(sql.toUpperCase()).not.toContain('INSERT INTO');
  });

  it('indexes the foreign keys the hot paths join on', () => {
    expect(sql).toContain('idx_identities_user_id');
    expect(sql).toContain('idx_sessions_user_id');
    expect(sql).toContain('idx_sessions_expires_at');
  });
});
