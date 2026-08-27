import { assertDisposableDatabase } from './require-database';

/**
 * The guard that stands between `npm run test:integration` and somebody's real
 * database.
 *
 * ⚠ THE INTERESTING CASES ARE THE REJECTIONS. A guard that accepts the right
 * database is easy; this one exists because the previous version accepted every
 * name containing "test", which is a set that includes `production_test`. Each
 * case below is a URL that used to pass.
 */
describe('the destructive-database guard', () => {
  const OK = 'postgres://backoffice@localhost:5432/backoffice_itest';

  describe('accepts only an approved disposable database', () => {
    it('accepts the database CI creates and drops per run', () => {
      expect(assertDisposableDatabase(OK, '1')).toBe('backoffice_itest');
    });

    it('accepts the second disposable name, so a local backend can keep running', () => {
      expect(
        assertDisposableDatabase('postgres://backoffice@127.0.0.1:5432/backoffice_test', '1'),
      ).toBe('backoffice_test');
    });

    it('accepts loopback spelled as IPv6', () => {
      expect(assertDisposableDatabase('postgres://backoffice@[::1]:5432/backoffice_itest', '1')).toBe(
        'backoffice_itest',
      );
    });
  });

  describe('refuses anything else, however it is named', () => {
    /**
     * ★ THE CASE THAT MOTIVATED THE CHANGE. Every one of these contains "test"
     * and would have been accepted by the substring check it replaced.
     */
    it.each([
      'postgres://u@localhost:5432/production_test',
      'postgres://u@localhost:5432/customer-testing',
      'postgres://u@localhost:5432/latest_backup',
      'postgres://u@localhost:5432/mytest',
    ])('refuses %s', (url) => {
      expect(() => assertDisposableDatabase(url, '1')).toThrow(/not an approved disposable database/);
    });

    it('refuses a database with no "test" in the name at all', () => {
      expect(() => assertDisposableDatabase('postgres://u@localhost:5432/backoffice', '1')).toThrow(
        /not an approved disposable database/,
      );
    });

    /** Staging is the realistic accident: an approved NAME on a remote HOST. */
    it('refuses an approved name on a remote host', () => {
      expect(() =>
        assertDisposableDatabase('postgres://u@db.staging.internal:5432/backoffice_itest', '1'),
      ).toThrow(/not this machine/);
    });

    it('refuses a malformed URL rather than guessing at it', () => {
      expect(() => assertDisposableDatabase('not-a-url', '1')).toThrow(/not a valid URL/);
    });

    it('refuses a missing DATABASE_URL_TEST', () => {
      expect(() => assertDisposableDatabase(undefined, '1')).toThrow(/is not set/);
    });
  });

  describe('requires the opt-in, separately from the target', () => {
    it('refuses an approved database when the opt-in is absent', () => {
      expect(() => assertDisposableDatabase(OK, undefined)).toThrow(/ALLOW_DESTRUCTIVE_DB_TESTS/);
    });

    it('refuses an opt-in that is present but not "1"', () => {
      // Anything short of the exact value is treated as absent: a variable left
      // over as "0" or "false" must not read as consent.
      expect(() => assertDisposableDatabase(OK, 'false')).toThrow(/ALLOW_DESTRUCTIVE_DB_TESTS/);
    });

    /**
     * The opt-in is checked BEFORE the target, so somebody who exported a
     * dangerous URL is told about the missing consent rather than being handed
     * a list of database names to try.
     */
    it('reports the missing opt-in first, even for a dangerous target', () => {
      expect(() =>
        assertDisposableDatabase('postgres://u@db.production.internal:5432/backoffice', undefined),
      ).toThrow(/ALLOW_DESTRUCTIVE_DB_TESTS/);
    });
  });
});
