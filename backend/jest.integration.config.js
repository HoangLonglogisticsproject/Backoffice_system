/**
 * The PostgreSQL integration suite — `npm run test:integration`.
 *
 * ★ WHY A SECOND CONFIG RATHER THAN A FLAG. `npm test` and this command answer
 * different questions and must be able to fail for different reasons: one is
 * "does the code work", the other is "does the code work against a real
 * database". Folding them together is what let 261 tests report as PENDING
 * while the suite exited 0.
 *
 * ★ DISCOVERY IS BY FILENAME, NOT BY DIRECTORY, and the two are deliberately
 * independent. A spec lives in the folder its SUBJECT belongs to
 * (`tests/migrations/` for the migration specs) while `*.integration.spec.ts`
 * is what declares it needs infrastructure. That is why the migration folder
 * can hold both DB-free schema specs and one integration spec without either
 * ending up in the wrong command.
 *
 * The base configuration is read from `package.json` so the transform, the
 * module aliases and the environment cannot drift between the two commands.
 */
const base = require('./package.json').jest;

// `testRegex` and `testMatch` are mutually exclusive in Jest; the base sets the
// former, so it is dropped rather than overridden.
const { testRegex: _testRegex, ...shared } = base;

module.exports = {
  ...shared,
  testMatch: ['<rootDir>/tests/**/*.integration.spec.ts'],
  // The base excludes integration specs so `npm test` never picks them up.
  // Here they are the entire point.
  testPathIgnorePatterns: ['/node_modules/'],
  // Fails the run when there is no database, instead of reporting 261 pending
  // tests and exiting 0.
  globalSetup: '<rootDir>/tests/helpers/require-database.js',
};
