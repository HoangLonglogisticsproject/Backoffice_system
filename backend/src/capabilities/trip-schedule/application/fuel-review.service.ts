import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { toOffsetPage, type OffsetPage } from '../../../common/pagination/offset-page';
import { DATABASE, type Database } from '../../../common/types/database.port';
import type { FuelCandidate } from '../domain/fuel-match';
import {
  ACCOUNTING_ACTIONS,
  REVIEW_REASON_REQUIRED,
  canMove,
  needsReason,
  type AccountingAction,
  type FuelReviewEvent,
  type FuelReviewStatus,
  type FuelSubmission,
} from '../domain/fuel-review';
import type { FuelTransactionView } from '../domain/fuel-transaction-view';
import { FuelReviewRepository } from '../persistence/fuel-review.repository';
import { FuelTransactionRepository } from '../persistence/fuel-transaction.repository';
import { FuelMatchService } from './fuel-match.service';
import { FuelTransactionService } from './fuel-transaction.service';

/** Everything Accounting decides on: the fill as it stands, its steps so far, and what looks like it. */
export interface FuelReviewDetail {
  status: FuelReviewStatus;
  fill: FuelTransactionView;
  history: FuelReviewEvent[];
  /** Other fills holding its image or invoice, or the same lorry, amount and day — flagged, never merged. */
  warnings: FuelCandidate[];
}

/**
 * ★ ACCOUNTING CHECKS A DRIVER'S FILL, THEN SAYS IT WAS PAID (0038). Each
 * decision is one more append-only step, taken under the fill's row lock and
 * allowed only as the next move (`canMove`, held again by the database): a
 * fill is approved before it is paid, asked about or refused only with a
 * reason. The same decision twice is the decision already taken. Nothing
 * here touches the money row — a rejected fill is not paid; withdrawing its
 * cost is the SuperAdmin's void, a separate act.
 */
@Injectable()
export class FuelReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reviews: FuelReviewRepository,
    private readonly transactions: FuelTransactionRepository,
    private readonly fuel: FuelTransactionService,
    private readonly matches: FuelMatchService,
  ) {}

  async list(status: FuelReviewStatus | undefined, page: number, limit: number): Promise<OffsetPage<FuelSubmission>> {
    const { items, total } = await this.reviews.list({
      ...(status ? { statuses: [status] } : {}),
      limit,
      offset: (page - 1) * limit,
    });
    return toOffsetPage(items, total, page, limit);
  }

  async detail(fuelTransactionId: string): Promise<FuelReviewDetail> {
    const submission = await this.reviews.submission(fuelTransactionId);
    const latest = submission ? await this.reviews.latest(fuelTransactionId) : null;
    if (!submission || !latest) throw new NotFoundError('Fuel submission not found.');
    const fill = await this.fuel.viewOfVehicleCost(submission.vehicleId, submission.costId);
    const shas = fill.evidence.filter((image) => !image.retiredAt).map((image) => image.sha256);
    const facts = {
      ...(fill.liters ? { liters: fill.liters } : {}),
      ...(fill.vendor?.taxCode ? { vendorTaxCode: fill.vendor.taxCode } : {}),
      ...(fill.document?.series ? { documentSeries: fill.document.series } : {}),
      ...(fill.document?.number ? { documentNumber: fill.document.number } : {}),
    };
    const { matches } = await this.matches.compare(
      submission.vehicleId,
      { businessDate: fill.businessDate as string, amount: fill.amount, facts },
      shas,
      fuelTransactionId,
    );
    return { status: latest.status, fill, history: await this.reviews.history(fuelTransactionId), warnings: matches };
  }

  async act(fuelTransactionId: string, action: AccountingAction, note: string | undefined, actor: string): Promise<FuelReviewDetail> {
    const to = ACCOUNTING_ACTIONS[action];
    const reason = note?.trim() || null;
    if (needsReason(to) && !reason) {
      throw new ValidationError('Asking for more, or refusing, needs a reason the driver can read.', { note: REVIEW_REASON_REQUIRED });
    }
    const submission = await this.reviews.submission(fuelTransactionId);
    if (!submission) throw new NotFoundError('Fuel submission not found.');
    await this.db.transaction(async (tx) => {
      const stored = await this.transactions.lockLive('vehicle_cost_id', submission.costId, tx);
      if (stored?.id !== fuelTransactionId) throw new NotFoundError('Fuel submission not found.');
      const latest = await this.reviews.latest(fuelTransactionId, tx);
      if (!latest || latest.status === to) return; // the decision already taken: nothing new
      if (!canMove(latest.status, to)) throw new ConflictError(`A fill that is ${latest.status} cannot become ${to}.`);
      await this.reviews.append({ fuelTransactionId, seq: latest.seq + 1, status: to, note: reason, actor }, tx);
    });
    return this.detail(fuelTransactionId);
  }
}
