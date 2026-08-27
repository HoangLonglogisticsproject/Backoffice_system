import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The migration directory these specs read.
 *
 * The specs live under `tests/migrations/` while the SQL they assert on stays
 * in `migrations/` — the deployable artefact, which holds nothing but `.sql`.
 * `__dirname` therefore no longer IS the migration directory, so it is named
 * once here rather than rebuilt at each call site.
 */
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');


/**
 * Asserts the SHAPE of the organization migration without a database.
 *
 * Same job as `migration-schema.spec.ts` does for 0001, and the same limit: it
 * is not a substitute for running the file against PostgreSQL — that is
 * `src/core/organization/organization.integration.spec.ts`. What this catches is
 * the class of mistake that survives review and only shows up later as a
 * corrupted organization: a missing partial index, a cascade that eats history,
 * a seeded department name.
 */
describe('0003_organization.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0003_organization.sql'), 'utf8');
  });

  const normalized = (): string => sql.replace(/\s+/g, ' ');

  /**
   * The file with its `--` comments removed.
   *
   * Needed because this file DOCUMENTS the decisions it makes — it says in prose
   * that memberships are deliberately NOT `ON DELETE CASCADE`. A check that
   * greps the raw text trips over that sentence and reports the opposite of the
   * truth. The same trap `check-boundaries.sh` calls out: a checker that fails
   * on its own documentation is a checker somebody switches off.
   */
  const code = (): string => sql.replace(/--[^\n]*/g, '');

  it('creates exactly the two organization tables and nothing else', () => {
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(['department_memberships', 'departments']);
  });

  it('creates no table a later phase owns', () => {
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);

    for (const premature of [
      'role_assignments',
      'roles',
      'permissions',
      'role_permissions',
      'membership_change_requests',
      'account_invitations',
      'audit_logs',
    ]) {
      expect(created).not.toContain(premature);
    }
  });

  it('is idempotent, so it can run twice without breaking a deploy', () => {
    const creates = [...sql.matchAll(/CREATE (TABLE|INDEX|UNIQUE INDEX)/g)].length;
    const guarded = [...sql.matchAll(/CREATE (?:TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS/g)].length;
    expect(guarded).toBe(creates);
  });

  it('re-creates its trigger rather than assuming it is absent', () => {
    // PostgreSQL has no CREATE OR REPLACE TRIGGER before 14, so the file must
    // drop first to stay re-runnable — the same pattern 0002 established.
    expect(normalized()).toContain('DROP TRIGGER IF EXISTS departments_set_updated_at');
    expect(normalized()).toContain('CREATE TRIGGER departments_set_updated_at');
  });

  it('★ enforces at most one ACTIVE membership per user, system-wide', () => {
    // The single most important line in the file. Note the absence of
    // department_id: the index is per user, not per user-and-unit, which is
    // what makes belonging to two units at once impossible rather than merely
    // discouraged.
    expect(normalized()).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_membership ON department_memberships (user_id) WHERE status = \'active\'',
    );
  });

  it('constrains both lifecycles instead of trusting the application', () => {
    expect(normalized()).toContain("CHECK (status IN ('active', 'archived'))");
    expect(normalized()).toContain("CHECK (status IN ('active', 'ended'))");
  });

  it('keeps status and ended_at from disagreeing about whether a membership is over', () => {
    expect(normalized()).toContain("CHECK ((status = 'ended') = (ended_at IS NOT NULL))");
  });

  it('makes a department slug unique', () => {
    expect(normalized()).toContain('UNIQUE (slug)');
  });

  it('does NOT cascade memberships from users — history must survive a manual delete', () => {
    // 0001 cascades identities and sessions on purpose; memberships are history
    // and must not follow. A cascade here would silently erase where somebody
    // worked the moment anyone ran a DELETE during an incident.
    const withoutComments = code();
    const membershipsSection = withoutComments.slice(
      withoutComments.indexOf('CREATE TABLE IF NOT EXISTS department_memberships'),
    );
    expect(membershipsSection).not.toContain('ON DELETE CASCADE');

    // And the check really does catch what it claims to, rather than passing
    // because it is looking at nothing.
    expect('user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE').toContain(
      'ON DELETE CASCADE',
    );
  });

  it('indexes the two access paths the hot queries use', () => {
    expect(sql).toContain('idx_membership_department_active');
    expect(sql).toContain('idx_membership_user');
  });

  it('seeds no data — a department is data an administrator enters, not schema', () => {
    expect(sql.toUpperCase()).not.toContain('INSERT INTO');
  });

  it('names no customer and no business unit', () => {
    // The boundary that keeps this foundation reusable. A department name in a
    // migration is the moment "generic" quietly becomes "generic for one
    // company".
    expect(sql).not.toMatch(/sales|marketing|operations|finance|logistics|hoanglong/i);
  });
});
