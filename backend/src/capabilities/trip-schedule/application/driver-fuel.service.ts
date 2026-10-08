import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain.error';
import { DATABASE, type Database } from '../../../common/types/database.port';
import type { FuelEvidence } from '../domain/fuel-evidence';
import type { DriverFuelSubmission, FuelReviewStatus, FuelSubmission } from '../domain/fuel-review';
import { FuelEvidenceRepository, publicEvidence } from '../persistence/fuel-evidence.repository';
import { FuelReviewRepository } from '../persistence/fuel-review.repository';
import { FuelTransactionRepository } from '../persistence/fuel-transaction.repository';
import type { DriverReceipt } from './fuel-submission-writer';
import { FuelTransactionWriter, normalized } from './fuel-transaction-writer';

/** A driver's own fill, with the steps it went through and the images they sent. */
export type DriverFuelSubmissionDetail = DriverFuelSubmission & {
  history: Array<{ status: FuelReviewStatus; note: string | null; at: Date }>;
  evidence: FuelEvidence[];
};

/** The most a driver's list returns — a phone's worth, newest first. */
const DRIVER_LIST_LIMIT = 100;

const forDriver = ({ costId: _cost, driver: _driver, ...rest }: FuelSubmission): DriverFuelSubmission => rest;

/**
 * ★ THE DRIVER'S SIDE OF A FILL'S REVIEW (0038): their own fills only, read
 * back with the state Accounting left them in — and, when Accounting asked for
 * more, the one thing they may do: add what was missing and send it again.
 * Never another driver's fill, never a ledger, never a decision.
 */
@Injectable()
export class DriverFuelService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reviews: FuelReviewRepository,
    private readonly transactions: FuelTransactionRepository,
    private readonly writer: FuelTransactionWriter,
    private readonly evidence: FuelEvidenceRepository,
  ) {}

  async mine(driver: string, filter: { statuses?: readonly FuelReviewStatus[]; businessDate?: string }): Promise<DriverFuelSubmission[]> {
    const { items } = await this.reviews.list({ ...filter, driver, limit: DRIVER_LIST_LIMIT, offset: 0 });
    return items.map(forDriver);
  }

  async detail(driver: string, fuelTransactionId: string): Promise<DriverFuelSubmissionDetail> {
    const { items } = await this.reviews.list({ driver, fuelTransactionId, limit: 1, offset: 0 });
    const [own] = items;
    if (!own) throw new NotFoundError('Fuel submission not found.');
    const history = (await this.reviews.history(fuelTransactionId)).map(({ status, note, at }) => ({ status, note, at }));
    // Only the images they sent: anything else on the fill is Accounting's, not theirs to open.
    const images = (await this.evidence.listByTransaction(fuelTransactionId)).filter((image) => image.uploadedBy.id === driver);
    return { ...forDriver(own), history, evidence: images.map(publicEvidence) };
  }

  /**
   * ★ ONLY WHEN ACCOUNTING ASKED (`needs_info`). What was missing is added the
   * way every fact is — once, never over a value already there — the driver's
   * own new images are attached, and the fill goes back to `submitted`, all in
   * one transaction under the fill's row lock. The money row is untouched:
   * a wrong amount or liters is a rejection and a new fill, never an edit.
   */
  async resubmit(driver: string, fuelTransactionId: string, receipt: DriverReceipt & { note?: string }): Promise<DriverFuelSubmissionDetail> {
    const submission = await this.reviews.submission(fuelTransactionId);
    if (submission?.driverUserId !== driver) throw new NotFoundError('Fuel submission not found.');
    const facts = normalized(receipt.facts);
    await this.db.transaction(async (tx) => {
      const stored = await this.transactions.lockLive('vehicle_cost_id', submission.costId, tx);
      if (stored?.id !== fuelTransactionId) throw new NotFoundError('Fuel submission not found.');
      const latest = await this.reviews.latest(fuelTransactionId, tx);
      if (latest?.status !== 'needs_info') throw new ConflictError('Only a fill Accounting asked about can be sent again.');
      await this.writer.complete(stored, { facts, evidence: receipt.evidence }, driver, tx);
      const note = receipt.note?.trim() || null;
      await this.reviews.append({ fuelTransactionId, seq: latest.seq + 1, status: 'submitted', note, actor: driver }, tx);
    });
    return this.detail(driver, fuelTransactionId);
  }
}
