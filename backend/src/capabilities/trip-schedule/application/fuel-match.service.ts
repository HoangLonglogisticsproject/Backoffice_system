import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { judge, type FuelMatchResult, type FuelReceipt, type SeenCost } from '../domain/fuel-match';
import type { FuelFactsInput } from '../domain/fuel-transaction';
import { FuelMatchRepository, type DocumentIdentity } from '../persistence/fuel-match.repository';
import { FuelTransactionRepository } from '../persistence/fuel-transaction.repository';
import type { FuelViewRecord } from '../persistence/fuel-transaction-view.repository';
import { normalized } from './fuel-transaction-writer';

export interface FuelMatchQuery {
  businessDate: string;
  amount: string;
  liters?: string;
  vendorName?: string;
  vendorTaxCode?: string;
  documentSeries?: string;
  documentNumber?: string;
  /** The caller's own uploaded images of the receipt. */
  evidence: readonly string[];
}

/** One receipt is a tax code and a number; without both there is nothing to compare. */
export const documentIdentityOf = (facts: FuelFactsInput): DocumentIdentity | null =>
  facts.vendorTaxCode && facts.documentNumber
    ? { taxCode: facts.vendorTaxCode, number: facts.documentNumber, series: facts.documentSeries ?? null }
    : null;

/**
 * ★ READ-ONLY, BOTH LEDGERS. Finds the costs a receipt may already be recorded
 * as — the lorry's fuel costs around the day on `vehicle_costs` and
 * `trip_costs`, and any live fill already holding the receipt's image or
 * document, on any lorry — and judges them (`judge`). It writes nothing and
 * chooses nothing: attaching is a separate command naming one cost.
 */
@Injectable()
export class FuelMatchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly matches: FuelMatchRepository,
    private readonly transactions: FuelTransactionRepository,
  ) {}

  async find(vehicleId: string, query: FuelMatchQuery, by: string): Promise<FuelMatchResult> {
    const { businessDate, amount, evidence, ...typed } = query;
    const facts = normalized(typed);
    if (!(await this.transactions.vehicleExists(vehicleId, this.db))) throw new NotFoundError('Vehicle not found.');
    const images = await this.matches.imagesOf(evidence, by);
    if (images.size !== evidence.length) {
      throw new ValidationError('Only images you uploaded can be compared.', { evidence: 'NOT_STAGED' });
    }
    return this.compare(vehicleId, { businessDate, amount, facts }, [...new Set(images.values())], null);
  }

  /**
   * Judges a receipt — its day, amount, facts and image hashes — against the
   * lorry's fuel around the day and every live fill holding its image or
   * document. `except` leaves one fill out: the fill being reviewed is not its
   * own duplicate.
   */
  async compare(vehicleId: string, receipt: FuelReceipt, shas: readonly string[], except: string | null): Promise<FuelMatchResult> {
    const { businessDate, amount, facts } = receipt;
    const document = documentIdentityOf(facts);
    const nearby = (await this.matches.nearby(vehicleId, businessDate, amount)).filter(
      (view) => except === null || view.fuelTransactionId !== except,
    );
    const hits = shas.length > 0 || document ? await this.matches.fillsHolding(shas, document, except) : [];
    const known = new Set(nearby.map((view) => view.fuelTransactionId).filter(Boolean));
    const elsewhere = await this.matches.ofFills([...new Set(hits.map((hit) => hit.fuelTransactionId))].filter((id) => !known.has(id)));

    const fills = [...nearby, ...elsewhere].flatMap((view) => (view.fuelTransactionId ? [view.fuelTransactionId] : []));
    const evidenceOn = await this.matches.evidenceOn(fills, shas);
    const seen = (view: FuelViewRecord, isNearby: boolean): SeenCost => {
      const { category: _category, ...rest } = view;
      const held = view.fuelTransactionId ? evidenceOn.get(view.fuelTransactionId) : undefined;
      return { view: rest, evidenceCount: held?.count ?? 0, imageOnFill: held?.hit ?? false, nearby: isNearby };
    };
    return judge(receipt, [...nearby.map((view) => seen(view, true)), ...elsewhere.map((view) => seen(view, false))]);
  }
}
