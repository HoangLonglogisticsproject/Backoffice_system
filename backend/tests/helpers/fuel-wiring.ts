import type { Database } from '../../src/common/types/database.port';
import { FuelDuplicateGuard } from '../../src/capabilities/trip-schedule/application/fuel-duplicate-guard';
import { FuelSubmissionWriter } from '../../src/capabilities/trip-schedule/application/fuel-submission-writer';
import { FuelTransactionWriter } from '../../src/capabilities/trip-schedule/application/fuel-transaction-writer';
import { FuelEvidenceRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-evidence.repository';
import { FuelMatchRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-match.repository';
import { FuelReviewRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-review.repository';
import { FuelTransactionRepository } from '../../src/capabilities/trip-schedule/persistence/fuel-transaction.repository';

/** The fuel writer as the module wires it: facts, images and the duplicate guard. */
export const fuelWriter = (database: Database): FuelTransactionWriter =>
  new FuelTransactionWriter(
    new FuelTransactionRepository(),
    new FuelEvidenceRepository(database),
    new FuelDuplicateGuard(new FuelMatchRepository(database)),
  );

/** What a driver's fill is submitted through (0038), as the module wires it. */
export const fuelSubmissionWriter = (database: Database): FuelSubmissionWriter =>
  new FuelSubmissionWriter(fuelWriter(database), new FuelReviewRepository(database));
