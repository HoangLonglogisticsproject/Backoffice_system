import { randomBytes } from 'node:crypto';
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

/**
 * A photo the driver has waiting, as an upload leaves its row (0037) — for the
 * specs about the fill, not the upload: no bytes are stored. A driver's fill
 * needs at least one (0038), so their fixtures send this.
 */
export const stagedPhoto = async (database: Database, by: string): Promise<{ id: string; type: 'receipt' }> => {
  const sha256 = randomBytes(32).toString('hex');
  const row = await new FuelEvidenceRepository(database).insertStaged({
    sha256,
    storageKey: `fuel-evidence/${sha256}`,
    mimeType: 'image/jpeg',
    byteSize: 1,
    originalFilename: null,
    uploadedBy: by,
  });
  return { id: row.id, type: 'receipt' };
};
