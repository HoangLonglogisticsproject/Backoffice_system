import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../../common/errors/domain.error';
import type { DatabaseQuery } from '../../../common/types/database.port';
import type { EvidenceAttachment } from '../domain/fuel-evidence';
import type { FuelFactsInput } from '../domain/fuel-transaction';
import { FuelReviewRepository } from '../persistence/fuel-review.repository';
import { FuelTransactionWriter, normalized } from './fuel-transaction-writer';

/**
 * What a driver read off the receipt and photographed. The lorry, the day and
 * the money are the fill's own `vehicle_costs` row — never sent twice, and the
 * readings (liters, odometer) live there too.
 */
export interface DriverReceipt {
  facts: Pick<FuelFactsInput, 'occurredAt' | 'vendorName' | 'vendorTaxCode' | 'documentSeries' | 'documentNumber'>;
  evidence: readonly EvidenceAttachment[];
}

export const NO_RECEIPT: DriverReceipt = { facts: {}, evidence: [] };

/** The `details` code when a driver's fill comes without a single photo. */
export const EVIDENCE_REQUIRED = 'EVIDENCE_REQUIRED';

/**
 * ★ A DRIVER'S FILL IS SUBMITTED IN THE TRANSACTION THAT RECORDS IT (0038).
 * Right after its `vehicle_costs` row: its fuel transaction opens (the driver
 * its provenance), the receipt's facts are added and the driver's own images
 * attached, the duplicate guard is asked — a driver acknowledges nothing, so
 * an image or a document already on another fill refuses the fill — and the
 * first review step is written. One cost, one fuel transaction, one review:
 * a refusal anywhere leaves none of them.
 *
 * ★ AT LEAST ONE PHOTO — the pump, the receipt, the voucher or the station's
 * QR, whichever the station gives: a fill Accounting cannot see is not
 * submitted. (A retry by key is answered with the stored fill before this.)
 */
@Injectable()
export class FuelSubmissionWriter {
  constructor(
    private readonly writer: FuelTransactionWriter,
    private readonly reviews: FuelReviewRepository,
  ) {}

  async submit(
    cost: { id: string; vehicleId: string; businessDate: string },
    receipt: DriverReceipt,
    driver: string,
    tx: DatabaseQuery,
  ): Promise<string> {
    if (receipt.evidence.length === 0) {
      throw new ValidationError('A fuel fill needs at least one photo — the pump, the receipt or the station’s QR.', {
        evidence: EVIDENCE_REQUIRED,
      });
    }
    const fill = await this.writer.open(
      { vehicleId: cost.vehicleId, businessDate: cost.businessDate, vehicleCostId: cost.id, tripCostId: null },
      driver,
      driver,
      tx,
    );
    await this.writer.complete(fill, { facts: normalized(receipt.facts), evidence: receipt.evidence }, driver, tx);
    await this.reviews.append({ fuelTransactionId: fill.id, seq: 1, status: 'submitted', note: null, actor: driver }, tx);
    return fill.id;
  }
}
