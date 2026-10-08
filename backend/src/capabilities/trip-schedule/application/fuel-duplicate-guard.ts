import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../../common/errors/domain.error';
import type { DatabaseQuery } from '../../../common/types/database.port';
import type { FuelFactsInput } from '../domain/fuel-transaction';
import { FuelMatchRepository, type Acknowledgement, type DocumentIdentity } from '../persistence/fuel-match.repository';
import type { StoredFuelTransaction } from '../persistence/fuel-transaction.repository';

/** The `details` code when part of a receipt already sits on a fill the caller has not acknowledged. */
export const ON_ANOTHER_FILL = 'ON_ANOTHER_FILL';

/** An image this command attached, by its row and its bytes. */
export interface AttachedImage {
  id: string;
  sha256: string;
}

/** The receipt a fill names once this command's facts are in — only when this command named it. */
function documentAfter(fill: StoredFuelTransaction, added: FuelFactsInput): DocumentIdentity | null {
  const touched = added.vendorTaxCode ?? added.documentNumber ?? added.documentSeries;
  const taxCode = added.vendorTaxCode ?? fill.vendorTaxCode;
  const number = added.documentNumber ?? fill.documentNumber;
  if (!touched || !taxCode || !number) return null;
  return { taxCode, number, series: added.documentSeries ?? fill.documentSeries };
}

/**
 * ★ ONE RECEIPT ON TWO FILLS IS A DECISION, NEVER AN ACCIDENT (PR-2). An image
 * whose bytes already sit on another live fill, or a tax code and document
 * number another live fill already holds, is taken only when the caller names
 * that fill as seen and different — a station's statement can cover several
 * fills, so it is never a flat refusal. Each such decision is kept, append-only
 * (`fuel_match_acks`). Checked inside the writing transaction under a lock per
 * image and per document, so two writers cannot both miss each other; a replay
 * attaches and adds nothing, so it asks for nothing.
 */
@Injectable()
export class FuelDuplicateGuard {
  constructor(private readonly matches: FuelMatchRepository) {}

  async confirm(
    fill: StoredFuelTransaction,
    added: FuelFactsInput,
    attached: readonly AttachedImage[],
    acknowledged: readonly string[],
    by: string,
    tx: DatabaseQuery,
  ): Promise<void> {
    const document = documentAfter(fill, added);
    const shas = attached.map((image) => image.sha256);
    if (shas.length === 0 && !document) return;
    await this.matches.lockReceipt(
      [...shas.map((sha) => `image:${sha}`), ...(document ? [`document:${document.taxCode}/${document.number}`] : [])],
      tx,
    );

    const hits = await this.matches.fillsHolding(shas, document, fill.id, tx);
    const unseen = hits.filter((hit) => !acknowledged.includes(hit.fuelTransactionId));
    if (unseen.length > 0) {
      throw new ValidationError(
        'Part of this receipt is already on another fuel transaction; confirm that one is a different fill.',
        Object.fromEntries(unseen.map((hit) => [hit.basis === 'evidence_hash' ? 'evidence' : 'documentNumber', ON_ANOTHER_FILL])),
      );
    }
    const imageOf = new Map(attached.map((image) => [image.sha256, image.id]));
    const acks = hits.map(
      (hit): Acknowledgement => ({
        matchedFuelTransactionId: hit.fuelTransactionId,
        level: hit.basis === 'evidence_hash' ? 'exact' : 'high',
        basis: hit.basis,
        evidenceId: hit.sha256 ? (imageOf.get(hit.sha256) ?? null) : null,
      }),
    );
    await this.matches.acknowledge(fill.id, acks, by, tx);
  }
}
