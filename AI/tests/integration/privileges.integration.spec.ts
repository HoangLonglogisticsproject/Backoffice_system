import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { MigrationRunner } from '@infrastructure/database/migration-runner';
import { MIGRATIONS_DIR, TEST_URL, describeIntegration, urlAs } from '../helpers/integration-database';

/**
 * The database boundary, proven with the REAL provisioning scripts and REAL
 * roles.
 *
 *   ai_migrator     owns and migrates the schema; cannot read public
 *   ai_app          SELECT/INSERT/UPDATE on ai.*; no DELETE, no DDL,
 *                   no ledger, nothing in public
 *   ai_maintenance  SELECT+DELETE on the three retention tables only; no
 *                   INSERT/UPDATE, no DDL, no ledger, nothing in public;
 *                   pruning an alert cascades to its observations with no
 *                   grant on that table
 *   a role with no grants (stands in for bo_app) cannot see ai.* at all
 *
 * ★ EVERY TEST STANDS ALONE. `beforeAll` builds the whole environment —
 * roles, schema, migration AS ai_migrator, grants, the public probe, and the
 * fixture rows each role's tests act on — so any single test, or any `-t`
 * selection, runs against the same state as the full file. Fixtures for the
 * runtime tests (`APP_*`) and for the retention tests (`SEED_*`) are disjoint,
 * so neither role's writes change the other's expected row counts.
 *
 * ★ REQUIRES A SUPERUSER, and says so rather than skipping: creating roles is
 * cluster-level. Roles are dropped before AND after, so a rerun is clean and
 * the cluster is left as it was found.
 */
const SCRIPTS = join(__dirname, '..', '..', 'scripts');
const ROLES = ['ai_migrator', 'ai_app', 'ai_maintenance'] as const;
const STUB_ROLE = 'ai_itest_ungranted';
const PW = 'itest-only-password';
const PERMISSION_DENIED = '42501';

/** Retention fixtures: what ai_maintenance prunes. */
const SEED_ALERT = '33333333-3333-4333-8333-333333333333';
const SEED_RUN = '44444444-4444-4444-8444-444444444444';
const SEED_DETECTOR = 'SEED';
/** Runtime fixtures: what ai_app reads and writes. */
const APP_SUBJECT = '11111111-1111-4111-8111-111111111111';
const APP_RUN = '55555555-5555-4555-8555-555555555555';
const APP_DETECTOR = 'APP';

describeIntegration('AI database roles and grants', () => {
  jest.setTimeout(60_000);

  let admin: Pool;
  let dbName: string;
  let migrated: string[] = [];
  const asRole = (role: string): Pool => new Pool({ connectionString: urlAs(TEST_URL as string, role, PW), max: 2 });

  const dropRoles = async (): Promise<void> => {
    await admin.query('DROP SCHEMA IF EXISTS ai CASCADE');
    await admin.query('DROP TABLE IF EXISTS public.ai_privilege_probe');
    for (const role of [...ROLES, STUB_ROLE]) {
      await admin.query(
        `DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
             EXECUTE 'DROP OWNED BY ${role}';
           END IF;
         END $$`,
      );
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
    }
  };

  /**
   * The committed script, minus psql meta-commands (`\if`, `\connect`,
   * `\echo`), with the psql variables substituted. Everything PostgreSQL
   * itself executes is executed here, verbatim.
   */
  const provisioningSql = async (): Promise<string> => {
    const raw = await readFile(join(SCRIPTS, 'provision-ai-roles.sql'), 'utf8');
    return raw
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('\\'))
      .join('\n')
      .replaceAll(":'ai_migrator_pw'", `'${PW}'`)
      .replaceAll(":'ai_app_pw'", `'${PW}'`)
      .replaceAll(":'ai_maintenance_pw'", `'${PW}'`)
      .replaceAll(':"db"', `"${dbName}"`);
  };

  const expectDenied = async (promise: Promise<unknown>): Promise<void> => {
    await expect(promise).rejects.toMatchObject({ code: PERMISSION_DENIED });
  };

  const insertAlert = (pool: Pool, id: string | null, detector: string, subject: string) =>
    pool.query<{ id: string }>(
      `INSERT INTO ai.alerts (id, detector_code, detector_version, source_type, subject_type, subject_id,
                              severity, title, summary, evidence, evidence_version, dedupe_key)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, 1, 'rule', 'trip', $3::uuid,
               'warning', 'title', 'summary', '{}'::jsonb, 1, $4)
       RETURNING id`,
      [id, detector, subject, `${detector}:trip:${subject}`],
    );

  beforeAll(async () => {
    admin = new Pool({ connectionString: TEST_URL, max: 2 });
    dbName = new URL(TEST_URL as string).pathname.replace(/^\//, '');

    const who = await admin.query<{ rolsuper: boolean }>('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
    if (!who.rows[0]?.rolsuper) {
      throw new Error(
        'The privilege suite must connect as a superuser to create and drop roles. ' +
          'DATABASE_URL_TEST is not one — this is a FAILURE, not a skip.',
      );
    }

    // 1. Roles and the schema, from the committed script.
    await dropRoles();
    await admin.query(await provisioningSql());

    // 2. The migration, AS THE MIGRATOR — the run itself is an assertion.
    const migrator = asRole('ai_migrator');
    try {
      migrated = (await new MigrationRunner(migrator, MIGRATIONS_DIR, 'ai').run()).applied;
    } finally {
      await migrator.end();
    }

    // 3. The grants that need tables — the second committed script, verbatim.
    await admin.query(await readFile(join(SCRIPTS, 'provision-ai-grants.sql'), 'utf8'));

    // 4. A table in public owned by somebody else: what every backend table
    //    is, from the AI's point of view. Named so it can never collide.
    await admin.query('CREATE TABLE public.ai_privilege_probe (id INT)');
    await admin.query('INSERT INTO public.ai_privilege_probe VALUES (1)');

    // 5. A LOGIN role with no grants on schema ai — what bo_app is to this schema.
    await admin.query(`CREATE ROLE ${STUB_ROLE} LOGIN PASSWORD '${PW}'`);
    await admin.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${STUB_ROLE}`);

    // 6. Retention fixtures, seeded by the superuser: one alert with its
    //    birth row and one observation, and one scan run.
    await insertAlert(admin, SEED_ALERT, SEED_DETECTOR, SEED_ALERT);
    await admin.query(
      "INSERT INTO ai.alert_transition_history (alert_id, from_status, to_status, actor_type) VALUES ($1, NULL, 'open', 'system')",
      [SEED_ALERT],
    );
    await admin.query('INSERT INTO ai.alert_scan_observations (alert_id, scan_run_id) VALUES ($1, $2)', [SEED_ALERT, SEED_RUN]);
    await admin.query("INSERT INTO ai.scan_runs (id, detector_code, detector_version, phase) VALUES ($1, $2, 1, 'resolution')", [
      SEED_RUN,
      SEED_DETECTOR,
    ]);
  });

  afterAll(async () => {
    await dropRoles();
    await admin.end();
  });

  describe('ai_migrator — schema owner, migration only', () => {
    it('applied 0001 into the schema it owns, without needing to create it', async () => {
      expect(migrated).toContain('0001_alerts.sql');
      const owner = await admin.query<{ owner: string }>(
        "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'ai'",
      );
      expect(owner.rows[0]?.owner).toBe('ai_migrator');
      for (const table of ['alerts', 'alert_transition_history', 'alert_scan_observations', 'scan_runs', 'schema_migrations']) {
        const exists = await admin.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [`ai.${table}`]);
        expect(exists.rows[0]?.ok).toBe(true);
      }
    });

    it('cannot read operational tables in public', async () => {
      const migrator = asRole('ai_migrator');
      try {
        await expectDenied(migrator.query('SELECT * FROM public.ai_privilege_probe'));
      } finally {
        await migrator.end();
      }
    });
  });

  describe('ai_app — the runtime', () => {
    let app: Pool;
    beforeAll(() => {
      app = asRole('ai_app');
    });
    afterAll(async () => {
      await app.end();
    });

    it('can insert, read and update alerts, history, observations and scan runs', async () => {
      const inserted = await insertAlert(app, null, APP_DETECTOR, APP_SUBJECT);
      const id = inserted.rows[0]?.id as string;

      await app.query(
        "INSERT INTO ai.alert_transition_history (alert_id, from_status, to_status, actor_type) VALUES ($1, NULL, 'open', 'system')",
        [id],
      );
      await app.query('INSERT INTO ai.alert_scan_observations (alert_id, scan_run_id) VALUES ($1, $2)', [id, APP_RUN]);
      await app.query("INSERT INTO ai.scan_runs (id, detector_code, detector_version, phase) VALUES ($1, $2, 1, 'discovery')", [
        APP_RUN,
        APP_DETECTOR,
      ]);

      const read = await app.query('SELECT status FROM ai.alerts WHERE id = $1', [id]);
      expect(read.rows[0]).toEqual({ status: 'open' });
      const observed = await app.query('SELECT count(*)::int AS n FROM ai.alert_scan_observations WHERE alert_id = $1', [id]);
      expect(observed.rows[0]).toEqual({ n: 1 });

      const updated = await app.query("UPDATE ai.alerts SET title = 'renamed' WHERE id = $1", [id]);
      expect(updated.rowCount).toBe(1);
    });

    it('cannot DELETE from any AI table', async () => {
      await expectDenied(app.query('DELETE FROM ai.alerts'));
      await expectDenied(app.query('DELETE FROM ai.alert_transition_history'));
      await expectDenied(app.query('DELETE FROM ai.alert_scan_observations'));
      await expectDenied(app.query('DELETE FROM ai.scan_runs'));
      await expectDenied(app.query('TRUNCATE ai.scan_runs'));
    });

    it('cannot perform DDL in the AI schema', async () => {
      await expectDenied(app.query('CREATE TABLE ai.sneaky (id INT)'));
      await expectDenied(app.query('ALTER TABLE ai.alerts ADD COLUMN sneaky TEXT'));
      await expectDenied(app.query('DROP TABLE ai.scan_runs'));
    });

    it('cannot read the migration ledger', async () => {
      await expectDenied(app.query('SELECT * FROM ai.schema_migrations'));
    });

    it('cannot SELECT operational tables in public — including trip_schedules when it exists', async () => {
      await expectDenied(app.query('SELECT * FROM public.ai_privilege_probe'));

      const trips = await admin.query<{ ok: boolean }>("SELECT to_regclass('public.trip_schedules') IS NOT NULL AS ok");
      if (trips.rows[0]?.ok) {
        await expectDenied(app.query('SELECT * FROM public.trip_schedules'));
      }
    });
  });

  describe('ai_maintenance — retention only', () => {
    let maintenance: Pool;
    beforeAll(() => {
      maintenance = asRole('ai_maintenance');
    });
    afterAll(async () => {
      await maintenance.end();
    });

    it('cannot INSERT or UPDATE — it prunes, it does not write', async () => {
      await expectDenied(
        maintenance.query("INSERT INTO ai.scan_runs (detector_code, detector_version, phase) VALUES ('X', 1, 'discovery')"),
      );
      await expectDenied(maintenance.query("UPDATE ai.alerts SET title = 'x' WHERE id = $1", [SEED_ALERT]));
      await expectDenied(
        maintenance.query('INSERT INTO ai.alert_scan_observations (alert_id, scan_run_id) VALUES ($1, gen_random_uuid())', [SEED_ALERT]),
      );
    });

    it('cannot touch the ledger, and cannot TRUNCATE', async () => {
      await expectDenied(maintenance.query('DELETE FROM ai.schema_migrations'));
      await expectDenied(maintenance.query('SELECT * FROM ai.schema_migrations'));
      await expectDenied(maintenance.query('TRUNCATE ai.alerts'));
    });

    it('cannot perform DDL', async () => {
      await expectDenied(maintenance.query('CREATE TABLE ai.sneaky (id INT)'));
      await expectDenied(maintenance.query('ALTER TABLE ai.alerts DROP COLUMN title'));
      await expectDenied(maintenance.query('DROP TABLE ai.alerts'));
    });

    it('cannot SELECT operational tables in public', async () => {
      await expectDenied(maintenance.query('SELECT * FROM public.ai_privilege_probe'));
    });

    it('cannot DELETE observations directly — it holds no grant on that table', async () => {
      await expectDenied(maintenance.query('DELETE FROM ai.alert_scan_observations WHERE alert_id = $1', [SEED_ALERT]));
    });

    it('can DELETE from exactly the three retention tables, and pruning an alert cascades to its observations', async () => {
      const runs = await maintenance.query('DELETE FROM ai.scan_runs WHERE id = $1', [SEED_RUN]);
      expect(runs.rowCount).toBe(1);

      const story = await maintenance.query('DELETE FROM ai.alert_transition_history WHERE alert_id = $1', [SEED_ALERT]);
      expect(story.rowCount).toBe(1);

      // The cascade runs as the referencing table's owner (ai_migrator), so
      // the retention role needs — and has — no grant on observations.
      const alerts = await maintenance.query('DELETE FROM ai.alerts WHERE id = $1', [SEED_ALERT]);
      expect(alerts.rowCount).toBe(1);
      const left = await admin.query('SELECT count(*)::int AS n FROM ai.alert_scan_observations WHERE alert_id = $1', [SEED_ALERT]);
      expect(left.rows[0]).toEqual({ n: 0 });
    });
  });

  describe('a role with no grants on schema ai (what bo_app is)', () => {
    it('cannot see the AI tables at all', async () => {
      const stub = asRole(STUB_ROLE);
      try {
        await expectDenied(stub.query('SELECT * FROM ai.alerts'));
        await expectDenied(stub.query('SELECT * FROM ai.alert_scan_observations'));
        await expectDenied(stub.query("INSERT INTO ai.scan_runs (detector_code, detector_version, phase) VALUES ('T', 1, 'discovery')"));
      } finally {
        await stub.end();
      }
    });
  });
});
