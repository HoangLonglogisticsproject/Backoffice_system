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
 * The SHAPE of the authorization migrations, without a database.
 *
 * The behaviour is proven in `src/core/authorization/authorization.integration.spec.ts`
 * against a real server. What this file catches is the mistake that survives
 * review because the code still works: a uniqueness index quietly dropped, a
 * provenance CHECK removed, a MEMBER role smuggled into storage.
 */
describe('0004_authorization.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0004_authorization.sql'), 'utf8');
  });

  const normalized = (): string => sql.replace(/\s+/g, ' ');
  const code = (): string => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

  it('creates exactly one table', () => {
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(['role_assignments']);
  });

  it('stores only the two ASSIGNABLE roles — MEMBER is derived, never a row', () => {
    // A stored MEMBER row would be a second record of membership, free to
    // disagree with department_memberships about the same person.
    expect(code()).toContain("CHECK (role_key IN ('SUPERADMIN', 'DEPARTMENT_HEAD'))");
    expect(code()).not.toContain("'MEMBER'");
  });

  it('★ allows at most one active SuperAdmin system-wide', () => {
    expect(code()).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_superadmin ON role_assignments (role_key) WHERE role_key = 'SUPERADMIN' AND status = 'active'",
    );
  });

  it('★ allows at most one active head per department', () => {
    expect(code()).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_head_per_department ON role_assignments (scope_id) WHERE role_key = 'DEPARTMENT_HEAD' AND status = 'active'",
    );
  });

  it('★ ties an active head to an active membership of the same department', () => {
    // The composite foreign key, with the membership's status inside the key —
    // which is what makes ending that membership a violation too.
    expect(code()).toContain(
      'FOREIGN KEY (membership_id, user_id, scope_id, requires_membership_status) REFERENCES department_memberships (id, user_id, department_id, status)',
    );
    expect(code()).toContain('GENERATED ALWAYS AS');
  });

  it('keeps role, scope and membership from disagreeing', () => {
    expect(code()).toContain("CHECK ((scope_type = 'DEPARTMENT') = (scope_id IS NOT NULL))");
    expect(code()).toContain("CHECK ((role_key = 'SUPERADMIN') = (scope_type = 'GLOBAL'))");
    expect(code()).toContain(
      "CHECK ((role_key = 'DEPARTMENT_HEAD') = (membership_id IS NOT NULL))",
    );
  });

  it('records provenance for BOTH grant and revoke', () => {
    // Without revoked_via, a null revoked_by cannot be told apart from a column
    // somebody forgot to fill in.
    expect(code()).toContain("CHECK ((granted_via = 'api') = (granted_by IS NOT NULL))");
    expect(code()).toContain('CHECK ((revoked_via IS NULL) = (revoked_at IS NULL))');
    expect(code()).toContain(
      "CHECK (revoked_via IS NULL OR ((revoked_via = 'api') = (revoked_by IS NOT NULL)))",
    );
  });

  it('guards the ALTER that has no IF NOT EXISTS of its own', () => {
    expect(normalized()).toContain('IF NOT EXISTS ( SELECT 1 FROM pg_constraint');
    expect(normalized()).toContain('uq_membership_fk_target');
  });

  it('qualifies that guard by TABLE, not by constraint name alone', () => {
    // Constraint names are unique per table, not per database. A name-only check
    // reports "already there" because another schema happens to hold the same
    // name, skips the ALTER, and leaves the foreign key below without a target —
    // which is exactly how this file failed the first time it was written.
    expect(code()).toContain("conrelid = 'department_memberships'::regclass");
  });

  it('is idempotent for every CREATE it issues', () => {
    const creates = [...sql.matchAll(/CREATE (TABLE|INDEX|UNIQUE INDEX)/g)].length;
    const guarded = [...sql.matchAll(/CREATE (?:TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS/g)].length;
    expect(guarded).toBe(creates);
  });

  it('indexes the query the authorization context runs on every request', () => {
    expect(sql).toContain('idx_role_assignment_user_active');
  });

  it('seeds nothing — no bootstrap SuperAdmin baked into the schema', () => {
    expect(sql.toUpperCase()).not.toContain('INSERT INTO');
  });

  it('names no customer and no business unit', () => {
    expect(sql).not.toMatch(/sales|marketing|operations|finance|logistics|hoanglong/i);
  });
});

describe('0005_identity_credential_state.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0005_identity_credential_state.sql'), 'utf8');
  });

  it('adds the flag to identities, not to users', () => {
    // It is a fact about a credential, not about a person.
    expect(sql).toContain('ALTER TABLE identities');
    expect(sql).not.toMatch(/ALTER TABLE\s+users/);
  });

  it('is idempotent and needs no backfill', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS must_change_secret BOOLEAN NOT NULL DEFAULT false');
    expect(sql.toUpperCase()).not.toContain('UPDATE IDENTITIES');
  });
});
