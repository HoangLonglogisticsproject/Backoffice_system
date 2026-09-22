/**
 * The PostgreSQL integration suite — `npm run test:integration`.
 *
 * Same split as the backend, for the same reason: `npm test` answers "does the
 * code work" and this answers "does the code work against a real database",
 * and the two must be able to fail separately. Discovery is by filename
 * (`*.integration.spec.ts`), the base configuration is read from package.json
 * so transform and aliases cannot drift, and `globalSetup` refuses to run
 * against anything but an approved disposable database.
 */
const base = require('./package.json').jest;

const { testRegex: _testRegex, ...shared } = base;

module.exports = {
  ...shared,
  testMatch: ['<rootDir>/tests/**/*.integration.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  globalSetup: '<rootDir>/tests/helpers/require-database.ts',
};
