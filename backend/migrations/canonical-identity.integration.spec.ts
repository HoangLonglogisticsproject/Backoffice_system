import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { normalizeEmail } from '../src/core/users/domain/email';

/**
 * The canonical-identity invariant, enforced by REAL PostgreSQL.
 *
 * BUSINESS RULE: `uyen@hoanglongti.com` and `Uyen@hoanglongti.com` are ONE
 * account identity. `uyen@hoanglongti.com` and `phuonguyen@hoanglongti.com` are
 * two different people, and both are valid.
 *
 * ★ EVERY STATEMENT HERE GOES STRAIGHT TO THE DATABASE, with no service, no
 * repository and no validation in the way. That is the entire point. The
 * application already canonicalised before 0010 existed and the API already
 * answered 409 to every case variant — measured — so a test that goes through
 * the service would have passed just as well WITHOUT the migration and proved
 * nothing about it.
 *
 * What 0010 changed is where the guarantee lives. Before it, plain SQL could
 * insert `Uyen@…` beside `uyen@…` and both unique indexes stayed quiet, because
 * they indexed the raw column. These specs are the difference.
 */
const TEST_URL = process.env['DATABASE_URL_TEST'];
const describeIntegration = TEST_URL ? describe : describe.skip;
const SCHEMA = 'canonical_itest';

function assertLooksLikeATestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(`DATABASE_URL_TEST points at "${name}", which is not named as a test database.`);
  }
}

/** The schema as it stood BEFORE this invariant — what 0010 is applied on top of. */
const PRE_CANONICAL = [
  '0001_identity.sql',
  '0002_users_updated_at.sql',
  '0003_organization.sql',
  '0004_authorization.sql',
  '0005_identity_credential_state.sql',
  '0006_membership_change_requests.sql',
  '0007_account_invitations.sql',
  '0008_role_assignment_membership_fk_index.sql',
  '0009_list_pagination_indexes.sql',
];

const CANONICAL = '0010_canonical_email_identity.sql';
const MIGRATIONS = [...PRE_CANONICAL, CANONICAL];

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/**
 * What `withPreCanonicalSchema` reports when 0010 applied without raising.
 *
 * Neutral on purpose: two of the cases below WANT it to apply, and a sentinel
 * that reads "which it should not have" made those tests assert success by
 * matching a string that says the opposite.
 */
const APPLIED = 'APPLIED';

/**
 * The first row, or a failure that names the query.
 *
 * `noUncheckedIndexedAccess` is on, and it is right to be: `rows[0]` really can
 * be undefined. Asserting it away with `!` would hide the one case worth seeing
 * — an INSERT ... RETURNING that returned nothing.
 */
function one<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`Expected a row from ${what}, got none.`);
  return row;
}

describeIntegration('Canonical identity against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let userId: string;
  /** A second person: `invitations_no_self_approval` forbids deciding your own. */
  let deciderId: string;
  let departmentId: string;

  const applyMigrations = async (target: Pool, files: readonly string[]): Promise<void> => {
    for (const file of files) {
      await target.query(await readFile(join(__dirname, file), 'utf8'));
    }
  };

  it('applies EVERY migration in the directory — the list above is not stale', async () => {
    // ponytail: an assertion, not a loader. The two lists here are the test's
    // subject (everything before 0010, then 0010), so reading the directory
    // instead would erase the distinction this file is built on. What was
    // actually missing is a failure when a new migration lands and nobody
    // updates the list — silence, until the spec quietly tests a stale schema.
    const onDisk = (await readdir(__dirname)).filter((f) => f.endsWith('.sql')).sort();

    expect(MIGRATIONS).toEqual(onDisk);
    expect(CANONICAL).toBe(onDisk[onDisk.length - 1]);
  });

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);

    const setup = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    } finally {
      await setup.end();
    }

    pool = new Pool({ connectionString: TEST_URL, max: 4, options: `-c search_path=${SCHEMA}` });
    await applyMigrations(pool, MIGRATIONS);

    const user = await pool.query<{ id: string }>(
      "INSERT INTO users (display_name) VALUES ('Uyen') RETURNING id",
    );
    userId = one(user.rows, 'INSERT INTO users').id;

    const department = await pool.query<{ id: string }>(
      "INSERT INTO departments (slug, name) VALUES ('canon', 'Canon') RETURNING id",
    );
    departmentId = one(department.rows, 'INSERT INTO departments').id;

    const decider = await pool.query<{ id: string }>(
      "INSERT INTO users (display_name) VALUES ('Decider') RETURNING id",
    );
    deciderId = one(decider.rows, 'INSERT INTO users').id;
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool?.end();
  });

  /** Runs a statement and returns the SQLSTATE it failed with, or null. */
  const sqlstateOf = async (sql: string, params: readonly unknown[]): Promise<string | null> => {
    try {
      await pool.query(sql, params as unknown[]);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  };

  const insertLocalIdentity = (subject: string) =>
    sqlstateOf(
      `INSERT INTO identities (user_id, provider, subject, secret_hash)
       VALUES ($1, 'local', $2, 'hash')`,
      [userId, subject],
    );

  const insertPendingInvitation = (email: string) =>
    sqlstateOf(
      'INSERT INTO account_invitations (department_id, email, requested_by) VALUES ($1, $2, $3)',
      [departmentId, email, userId],
    );

  // ------------------------------- the two canonicalisers agree --------

  describe('★ canonical_identity() and normalizeEmail() agree', () => {
    /**
     * `canonical_identity` exists to mirror `normalizeEmail`. "Mirrors" is a
     * claim, and a claim that nothing checks stops being true quietly — so this
     * feeds the same inputs through both and compares.
     *
     * The whitespace list is EVERY code point `String.prototype.trim` removes.
     * PostgreSQL's own answers are all narrower: bare `btrim(x)` strips U+0020
     * alone, and its regex class adds the ASCII controls but neither U+00A0 nor
     * U+FEFF. Any of those would leave an address paddable in a way that
     * canonicalises differently on the two sides of the wire.
     */
    const WHITESPACE = [
      0x0009, 0x000a, 0x000b, 0x000c, 0x000d,
      0x0020, 0x00a0, 0x1680,
      0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
      0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
      0x2028, 0x2029,
      0x202f, 0x205f, 0x3000, 0xfeff,
    ];

    const canonicalInSql = async (value: string): Promise<string> => {
      const rows = await pool.query<{ canonical: string }>(
        'SELECT canonical_identity($1) AS canonical',
        [value],
      );
      return one(rows.rows, 'canonical_identity').canonical;
    };

    it.each(WHITESPACE.map((point) => [point.toString(16).padStart(4, '0'), point]))(
      'agrees on an address padded with U+%s',
      async (_label, point) => {
        const pad = String.fromCodePoint(point);
        const padded = `${pad}Uyen@HoangLongTI.com${pad}`;

        expect(await canonicalInSql(padded)).toBe(normalizeEmail(padded));
        // …and both actually canonicalise, rather than agreeing on a no-op.
        expect(normalizeEmail(padded)).toBe('uyen@hoanglongti.com');
      },
    );

    it.each([
      ['uyen@hoanglongti.com', 'already canonical'],
      ['UYEN@HOANGLONGTI.COM', 'upper case'],
      ['Uyen.Sales@HoangLongTI.com', 'a dotted local part'],
      ['phuonguyen@hoanglongti.com', 'a different person'],
      ['', 'the empty string'],
    ])('agrees on %s — %s', async (value) => {
      expect(await canonicalInSql(value)).toBe(normalizeEmail(value));
    });

    it('★ leaves interior whitespace alone, on both sides', async () => {
      // Trimming is about the ENDS. A rule that collapsed interior characters
      // would be a different rule, and would merge addresses that are not the
      // same person.
      const inner = `a${String.fromCodePoint(0x00a0)}b@hoanglongti.com`;

      expect(await canonicalInSql(inner)).toBe(normalizeEmail(inner));
      expect(normalizeEmail(inner)).toContain(String.fromCodePoint(0x00a0));
    });
  });

  // ------------------------------------------------------ local identity --

  describe('identities, provider = local', () => {
    beforeAll(async () => {
      expect(await insertLocalIdentity('uyen@hoanglongti.com')).toBeNull();
    });

    /**
     * ★ TWO LAYERS, AND THEY CATCH DIFFERENT THINGS.
     *
     * The unique index makes two rows that canonicalise alike collide. It does
     * NOT make a row canonical — a single `  Uyen@… ` was legal until 0010 grew
     * its CHECK, and for `identities` that is not cosmetic: every lookup
     * canonicalises the input and compares it to the RAW column, so the account
     * exists and nobody can ever sign in to it.
     *
     * So a NON-CANONICAL write is refused by the CHECK, before uniqueness is
     * ever consulted — 23514, not 23505. Asserting the code rather than "it
     * threw" is what keeps the two layers honest: if the CHECK were dropped,
     * these would fall through to 23505 and still look like they passed.
     */
    it.each([
      ['Uyen@hoanglongti.com', 'a capitalised local part'],
      ['UYEN@HOANGLONGTI.COM', 'all upper case'],
      ['uyen@HoangLongTI.com', 'a mixed-case domain'],
      ['  uyen@hoanglongti.com  ', 'surrounding whitespace'],
      ['  Uyen@HoangLongTI.com  ', 'both at once'],
      [`${String.fromCodePoint(0x00a0)}uyen@hoanglongti.com`, 'a leading NBSP'],
    ])('★ the CHECK refuses %s — %s', async (variant) => {
      expect(await insertLocalIdentity(variant)).toBe(CHECK_VIOLATION);
    });

    it('★ and the UNIQUE INDEX refuses an exact canonical duplicate', async () => {
      // The other half. This row passes the CHECK — it is already canonical —
      // so it reaches the index, which is the layer that answers "one person,
      // one identity".
      expect(await insertLocalIdentity('uyen@hoanglongti.com')).toBe(UNIQUE_VIOLATION);
    });

    it('★ still allows a DIFFERENT person whose address merely looks similar', async () => {
      // The rule constrains case and whitespace. It must not constrain the
      // local part itself, or two colleagues would collide.
      expect(await insertLocalIdentity('phuonguyen@hoanglongti.com')).toBeNull();
      expect(await insertLocalIdentity('uyen.sales@hoanglongti.com')).toBeNull();
    });
  });

  // ------------------------------------- federated providers are untouched --

  describe('★ a federated provider keeps its case-sensitive subject', () => {
    /**
     * An OIDC/SAML `sub` is an opaque, case-sensitive string by specification.
     * `AbC123` and `abc123` are two different subjects, and an index that
     * folded them together would merge two people's accounts.
     *
     * This is why `uq_local_identity_subject_canonical` is partial. Delete the
     * `WHERE provider = 'local'` and this spec is what fails.
     */
    /** A subject nothing else in this file uses, so each case owns its rows. */
    const federated = (suffix: string) =>
      sqlstateOf(
        "INSERT INTO identities (user_id, provider, subject) VALUES ($1, 'oidc', $2)",
        [userId, suffix],
      );

    it('accepts two subjects that differ only by case', async () => {
      const base = `Fed${Date.now()}Case`;

      expect(await federated(base)).toBeNull();
      expect(await federated(base.toLowerCase())).toBeNull();
    });

    it('still refuses a genuinely identical subject — 0001 covers every provider', async () => {
      // Inserts its own row first rather than leaning on the case above having
      // run: a test that only passes in file order reports the wrong thing the
      // day somebody runs it alone, or vitest reorders.
      const subject = `Fed${Date.now()}Exact`;

      expect(await federated(subject)).toBeNull();
      expect(await federated(subject)).toBe(UNIQUE_VIOLATION);
    });

    it('★ is not forced to be canonical either — the CHECK is local-only', async () => {
      // The constraint 0010 adds short-circuits on `provider <> 'local'`. An
      // opaque subject with surrounding whitespace is a legal `sub`, and folding
      // it would be this rule reaching somewhere it was told not to.
      expect(await federated(`  Fed${Date.now()}Padded  `)).toBeNull();
    });
  });

  // ------------------------------------------------- pending invitations --

  describe('account_invitations awaiting a decision', () => {
    beforeAll(async () => {
      expect(await insertPendingInvitation('newjoiner@hoanglongti.com')).toBeNull();
    });

    // Same two layers as identities: non-canonical never reaches uniqueness.
    it.each([
      ['NewJoiner@hoanglongti.com', 'a capitalised local part'],
      ['NEWJOINER@HOANGLONGTI.COM', 'all upper case'],
      ['  newjoiner@hoanglongti.com  ', 'surrounding whitespace'],
    ])('★ the CHECK refuses a pending invitation as %s — %s', async (variant) => {
      expect(await insertPendingInvitation(variant)).toBe(CHECK_VIOLATION);
    });

    it('★ and the UNIQUE INDEX refuses an exact canonical duplicate', async () => {
      expect(await insertPendingInvitation('newjoiner@hoanglongti.com')).toBe(
        UNIQUE_VIOLATION,
      );
    });

    it('allows a different address', async () => {
      expect(await insertPendingInvitation('nuna@hoanglongti.com')).toBeNull();
    });

    it('constrains PENDING rows only — a decided one stops reserving the address', async () => {
      // Matches 0007's original scope, which 0010 narrows by case and by
      // nothing else: once an invitation is decided, `identities` is what
      // refuses a second account for that person.
      await pool.query(
        `UPDATE account_invitations
            SET status = 'rejected', decided_by = $1, decided_at = now()
          WHERE canonical_identity(email) = 'nuna@hoanglongti.com'`,
        [deciderId],
      );

      // The CANONICAL spelling: what is being tested is the index's partial
      // scope, not the CHECK. `NUNA@…` would now be refused by the CHECK before
      // uniqueness was consulted, which would pass this test for the wrong
      // reason — it would prove nothing about `status = 'pending'`.
      expect(await insertPendingInvitation('nuna@hoanglongti.com')).toBeNull();
    });
  });

  // ------------------------------------------------- the migration refuses --

  describe('★ 0010 stops rather than repairing conflicting data', () => {
    /**
     * The audit blocks, exercised for real: build the pre-0010 schema, put the
     * exact rows in it that 0010 forbids, and confirm applying it RAISES and
     * changes nothing.
     *
     * A separate schema each time — the failure has to be the migration's, not
     * a leftover from the case before it.
     */
    const withPreCanonicalSchema = async (
      name: string,
      seed: (target: Pool) => Promise<void>,
    ): Promise<{ message: string; identityRows: number; invitationRows: number }> => {
      const setup = new Pool({ connectionString: TEST_URL, max: 1 });
      try {
        await setup.query(`DROP SCHEMA IF EXISTS ${name} CASCADE; CREATE SCHEMA ${name};`);
      } finally {
        await setup.end();
      }

      const scoped = new Pool({ connectionString: TEST_URL, max: 2, options: `-c search_path=${name}` });
      try {
        await applyMigrations(scoped, PRE_CANONICAL);
        await seed(scoped);

        let message = '';
        try {
          await applyMigrations(scoped, [CANONICAL]);
          message = APPLIED;
        } catch (error) {
          message = (error as Error).message;
        }

        // Both tables: the point of every case below is that the rows SURVIVE
        // the refusal, and an audit that stopped on one table must not have
        // quietly touched the other.
        const counted = await scoped.query<{ identities: string; invitations: string }>(
          `SELECT (SELECT count(*) FROM identities)::text          AS identities,
                  (SELECT count(*) FROM account_invitations)::text AS invitations`,
        );
        const row = one(counted.rows, 'count(*)');
        return {
          message,
          identityRows: Number(row.identities),
          invitationRows: Number(row.invitations),
        };
      } finally {
        await scoped.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
        await scoped.end();
      }
    };

    const seedUser = async (target: Pool): Promise<string> => {
      const row = await target.query<{ id: string }>(
        "INSERT INTO users (display_name) VALUES ('Seed') RETURNING id",
      );
      return one(row.rows, 'INSERT INTO users').id;
    };

    it('refuses when two local identities collide once canonicalised', async () => {
      const { message, identityRows } = await withPreCanonicalSchema('canon_dup_itest', async (t) => {
        const id = await seedUser(t);
        await t.query(
          `INSERT INTO identities (user_id, provider, subject, secret_hash)
           VALUES ($1, 'local', 'uyen@hoanglongti.com', 'h'),
                  ($1, 'local', 'Uyen@hoanglongti.com', 'h')`,
          [id],
        );
      });

      expect(message).toContain('local identities collide once canonicalised');
      expect(message).toContain('Colliding identity row ids');
      // Same redaction on this side — an email is personal data wherever it appears.
      expect(message).not.toContain('uyen@hoanglongti.com');
      expect(message).not.toContain('Uyen@hoanglongti.com');
      // ★ AND BOTH ROWS SURVIVE. The operator decides which account keeps its
      // history; a migration that merged them would make that choice silently.
      expect(identityRows).toBe(2);
    });

    it('refuses a non-canonical row even when nothing collides', async () => {
      const { message, identityRows } = await withPreCanonicalSchema('canon_mixed_itest', async (t) => {
        const id = await seedUser(t);
        await t.query(
          `INSERT INTO identities (user_id, provider, subject, secret_hash)
           VALUES ($1, 'local', 'Uyen@hoanglongti.com', 'h')`,
          [id],
        );
      });

      // The index would have accepted this row. It is still wrong: every lookup
      // canonicalises first, so nobody can ever sign in to it.
      expect(message).toContain('not canonical');
      expect(identityRows).toBe(1);
    });

    /**
     * The invitation half of the audit, which the identity cases above do not
     * reach: 0010 checks two tables, and a block that only ever ran against one
     * of them would look tested and be half-tested.
     */
    it('★ refuses when two PENDING invitations collide once canonicalised', async () => {
      const { message, invitationRows, identityRows } = await withPreCanonicalSchema(
        'canon_inv_dup_itest',
        async (t) => {
          const id = await seedUser(t);
          const department = await t.query<{ id: string }>(
            "INSERT INTO departments (slug, name) VALUES ('seed', 'Seed') RETURNING id",
          );
          const departmentSeed = one(department.rows, 'INSERT INTO departments').id;

          await t.query(
            `INSERT INTO account_invitations (department_id, email, requested_by)
             VALUES ($1, 'newjoiner@hoanglongti.com', $2),
                    ($1, 'NewJoiner@hoanglongti.com', $2)`,
            [departmentSeed, id],
          );
        },
      );

      expect(message).toContain('pending invitations collide once canonicalised');
      // ★ IDS, NOT THE ADDRESS. This text lands in a deploy log; the row id is
      // what the operator acts on and it identifies exactly one row.
      expect(message).toContain('Colliding row ids');
      expect(message).not.toContain('newjoiner@hoanglongti.com');
      expect(message).not.toContain('NewJoiner');
      // ★ Both survive: rejecting one is a decision, and it is not this file's.
      expect(invitationRows).toBe(2);
      expect(identityRows).toBe(0);
    });

    it('★ refuses a non-canonical PENDING invitation even when nothing collides', async () => {
      const { message, invitationRows } = await withPreCanonicalSchema(
        'canon_inv_mixed_itest',
        async (t) => {
          const id = await seedUser(t);
          const department = await t.query<{ id: string }>(
            "INSERT INTO departments (slug, name) VALUES ('seed', 'Seed') RETURNING id",
          );
          await t.query(
            `INSERT INTO account_invitations (department_id, email, requested_by)
             VALUES ($1, 'NewJoiner@hoanglongti.com', $2)`,
            [one(department.rows, 'INSERT INTO departments').id, id],
          );
        },
      );

      expect(message).toContain('not canonical');
      expect(invitationRows).toBe(1);
    });

    it('ignores a DECIDED invitation that is not canonical — the rule is about pending', async () => {
      // The index is partial on `status = 'pending'`, so a rejected row with odd
      // casing constrains nothing and must not block the migration either.
      const { message } = await withPreCanonicalSchema('canon_inv_decided_itest', async (t) => {
        const id = await seedUser(t);
        const other = await seedUser(t);
        const department = await t.query<{ id: string }>(
          "INSERT INTO departments (slug, name) VALUES ('seed', 'Seed') RETURNING id",
        );
        await t.query(
          `INSERT INTO account_invitations
             (department_id, email, requested_by, status, decided_by, decided_at)
           VALUES ($1, 'OldJoiner@hoanglongti.com', $2, 'rejected', $3, now())`,
          [one(department.rows, 'INSERT INTO departments').id, id, other],
        );
      });

      expect(message).toBe(APPLIED);
    });

    it('applies cleanly when the data is already canonical', async () => {
      const { message, identityRows } = await withPreCanonicalSchema('canon_ok_itest', async (t) => {
        const id = await seedUser(t);
        await t.query(
          `INSERT INTO identities (user_id, provider, subject, secret_hash)
           VALUES ($1, 'local', 'uyen@hoanglongti.com', 'h')`,
          [id],
        );
      });

      expect(message).toBe(APPLIED);
      expect(identityRows).toBe(1);
    });
  });
});
