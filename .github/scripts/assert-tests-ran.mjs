/**
 * Fails the build when a test suite reported success WITHOUT running.
 *
 * This exists because of a specific, verified failure mode. The backend
 * integration specs gate themselves on an environment variable:
 *
 *   const describeIntegration = TEST_URL ? describe : describe.skip;
 *
 * Without `DATABASE_URL_TEST` they do not fail — they are *pending*. Jest then
 * exits 0 and reports `success: true`. Measured on this repository:
 *
 *   numTotalTests 11 · numPassedTests 0 · numPendingTests 11 · success true
 *
 * So a green pipeline is not evidence that anything was tested. A typo in a
 * variable name, a renamed secret, or a service that failed to come up all
 * produce exactly that: a fast, green, empty run. This script turns that into a
 * failure, which is the only reading of it that is true.
 *
 * Usage:
 *   node .github/scripts/assert-tests-ran.mjs <results.json> <minimum-tests> <label>
 *
 * Reads the JSON summary that both Jest (`--json --outputFile`) and Vitest
 * (`--reporter=json --outputFile`) emit; the fields used below are common to
 * both and were confirmed against the real output of each.
 */
import { readFileSync } from 'node:fs';

const [file, minimumRaw, label = 'suite'] = process.argv.slice(2);

if (!file || !minimumRaw) {
  console.error('usage: assert-tests-ran.mjs <results.json> <minimum-tests> [label]');
  process.exit(2);
}

const minimum = Number(minimumRaw);

let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch (error_) {
  // A missing or unparseable report means the runner never got far enough to
  // write one. That is a failure, not a reason to skip the check.
  console.error(`✘ ${label}: could not read ${file} — ${error_.message}`);
  process.exit(1);
}

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const pending = report.numPendingTests ?? 0;
const todo = report.numTodoTests ?? 0;

const problems = [];
if (failed > 0) problems.push(`${failed} failed`);
if (pending > 0) problems.push(`${pending} skipped`);
if (todo > 0) problems.push(`${todo} todo`);
if (total < minimum) problems.push(`only ${total} tests ran, expected at least ${minimum}`);

console.log(
  `${label}: ${total} total · ${passed} passed · ${failed} failed · ${pending} skipped · ${todo} todo`,
);

if (problems.length > 0) {
  console.error(`✘ ${label}: ${problems.join(', ')}`);
  console.error(
    '  A suite that skips is not a suite that passed. If this is the integration' +
      '\n  suite, check that the database was reachable and DATABASE_URL_TEST was set.',
  );
  process.exit(1);
}

console.log(`✔ ${label}: every test ran`);
