/**
 * Refuses to run the integration suite without a database.
 *
 * ★ THE POINT IS THAT IT FAILS, LOUDLY. Each integration spec still guards
 * itself with `TEST_URL ? describe : describe.skip`, which is right when
 * somebody runs one file directly — but as the behaviour of a whole SUITE it is
 * a trap: Jest reports every case as PENDING and exits 0, so "the integration
 * tests passed" and "the integration tests never ran" look identical from the
 * outside. CI needed a second script to notice.
 *
 * This runs before any spec is collected, so `npm run test:integration` either
 * exercises a real PostgreSQL or stops with a message naming the variable.
 *
 * Plain CommonJS `.js` on purpose: a `globalSetup` module is loaded before the
 * transform pipeline is doing anything useful, and this file has no reason to
 * need TypeScript.
 */
module.exports = function requireDatabase() {
  const url = process.env.DATABASE_URL_TEST;

  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set, so the integration suite has no database to run against.\n' +
        'Point it at a disposable database whose name contains "test" — these specs wipe the schema:\n' +
        '  DATABASE_URL_TEST=postgres://backoffice@localhost:5432/backoffice_test npm run test:integration',
    );
  }

  // The same guard the specs apply per file, applied once for the run. A name
  // without "test" in it is far more likely to be somebody's real database.
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(
      `DATABASE_URL_TEST points at "${name}", which is not named as a test database. ` +
        'These specs TRUNCATE tables — point it at a disposable database whose name contains "test".',
    );
  }
};
