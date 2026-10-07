import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../../common/errors/domain.error';
import { businessToday } from '../../../common/pagination/date-range-page-query.dto';
import type { DatabaseQuery } from '../../../common/types/database.port';
import { MAX_EVIDENCE_PER_TRANSACTION, type EvidenceAttachment } from '../domain/fuel-evidence';
import {
  FACT_ALREADY_SET,
  FACT_INVALID,
  NO_FACTS,
  mergeFacts,
  normalizeFacts,
  type FuelFactKey,
  type FuelFactsInput,
} from '../domain/fuel-transaction';
import { FuelEvidenceRepository } from '../persistence/fuel-evidence.repository';
import { FuelTransactionRepository, type StoredFuelTransaction } from '../persistence/fuel-transaction.repository';

const byField = (keys: readonly FuelFactKey[], code: string) => Object.fromEntries(keys.map((key) => [key, code]));

/**
 * The steps both record commands share, always inside their transaction and
 * after the backing row is locked: open the fill, add facts, attach images.
 */
@Injectable()
export class FuelTransactionWriter {
  constructor(
    private readonly transactions: FuelTransactionRepository,
    private readonly evidence: FuelEvidenceRepository,
  ) {}

  /** Wraps a cost. The driver its own provenance names, if any, is the first fact. */
  async open(
    row: Omit<StoredFuelTransaction, 'id' | keyof typeof NO_FACTS>,
    provenanceDriver: string | null,
    by: string,
    tx: DatabaseQuery,
  ): Promise<StoredFuelTransaction> {
    const facts = provenanceDriver ? { driverUserId: provenanceDriver } : {};
    const opened = await this.transactions.insert({ ...row, ...NO_FACTS, ...facts, createdBy: by }, tx);
    await this.transactions.logFacts(opened.id, facts, by, tx);
    return opened;
  }

  /**
   * ★ FIELD BY FIELD, APPEND-ONLY: an empty fact is filled, the same value is
   * a no-op, a different value is refused by name — never overwritten.
   */
  async enrich(stored: StoredFuelTransaction, facts: FuelFactsInput, by: string, tx: DatabaseQuery): Promise<void> {
    const { additions, conflicts } = mergeFacts(stored, facts);
    if (conflicts.length > 0) {
      throw new ValidationError(
        'A recorded fact is never overwritten; the SuperAdmin corrects a wrong one.',
        byField(conflicts, FACT_ALREADY_SET),
      );
    }
    await this.checkFacts(additions, stored.businessDate, tx);
    await this.transactions.addFacts(stored.id, additions, tx);
    await this.transactions.logFacts(stored.id, additions, by, tx);
  }

  /**
   * Attaches the caller's own staged images. One already on this fill is a
   * replay; the same picture under another staged row is refused, as is a
   * fill past its cap. Another fill holding the same picture is a warning
   * for the duplicate check (PR-2), not a refusal here.
   */
  async attach(
    fuelTransactionId: string,
    items: readonly EvidenceAttachment[],
    by: string,
    tx: DatabaseQuery,
  ): Promise<void> {
    if (items.length === 0) return;
    const rows = new Map((await this.evidence.lockMany(items.map((item) => item.id), tx)).map((row) => [row.id, row]));
    const pending: EvidenceAttachment[] = [];
    for (const item of items) {
      const row = rows.get(item.id);
      if (row?.fuelTransactionId === fuelTransactionId) continue;
      if (!row || row.attachedAt || row.discardedAt || row.uploadedBy.id !== by) {
        throw new ValidationError(`Evidence ${item.id} is not an image you staged.`, { evidence: 'NOT_STAGED' });
      }
      pending.push(item);
    }

    const live = await this.evidence.liveOn(fuelTransactionId, tx);
    const shas = new Set(live.map((image) => image.sha256));
    for (const item of pending) {
      const sha = rows.get(item.id)?.sha256 as string;
      if (shas.has(sha)) {
        throw new ValidationError('That image is already on this fuel transaction.', { evidence: 'ALREADY_ON_TRANSACTION' });
      }
      shas.add(sha);
    }
    if (live.length + pending.length > MAX_EVIDENCE_PER_TRANSACTION) {
      throw new ValidationError(`A fuel transaction holds at most ${MAX_EVIDENCE_PER_TRANSACTION} images.`, {
        evidence: 'TOO_MANY_IMAGES',
      });
    }
    await this.evidence.attachMany(pending, fuelTransactionId, by, new Date(), tx);
  }

  /** The rules a fact must meet that its column alone cannot say. */
  private async checkFacts(facts: FuelFactsInput, businessDate: string, tx: DatabaseQuery): Promise<void> {
    if (facts.occurredAt) {
      if (facts.occurredAt.getTime() > Date.now()) {
        throw new ValidationError('A fill cannot have happened in the future.', { occurredAt: 'IN_THE_FUTURE' });
      }
      if (businessToday(facts.occurredAt) !== businessDate) {
        throw new ValidationError('The time must fall on the fill’s business day.', { occurredAt: 'NOT_ON_BUSINESS_DATE' });
      }
    }
    if (facts.driverUserId && !(await this.transactions.isDriverAccount(facts.driverUserId, tx))) {
      throw new ValidationError('The driver must be a driver account.', { driverUserId: 'NOT_A_DRIVER' });
    }
  }
}

/** One spelling per fact, or a 422 naming each fact that is not in a recognised form. */
export function normalized(input: FuelFactsInput): FuelFactsInput {
  const { facts, invalid } = normalizeFacts(input);
  if (invalid.length > 0) {
    throw new ValidationError('Some facts are not in a recognised form.', Object.fromEntries(invalid.map((key) => [key, FACT_INVALID])));
  }
  return facts;
}

const fixed = (field: string) =>
  new ValidationError('The lorry, the day and the readings of a fuel transaction are fixed once recorded.', { [field]: 'FIXED' });

/** Re-sending a trip fill's lorry, day or readings is fine; changing them is not. */
export function refuseChangedFixedFields(
  live: StoredFuelTransaction,
  command: { vehicleId?: string; businessDate?: string; liters?: string; odometerKm?: number },
): void {
  if (command.vehicleId !== undefined && command.vehicleId !== live.vehicleId) throw fixed('vehicleId');
  if (command.businessDate !== undefined && command.businessDate !== live.businessDate) throw fixed('businessDate');
  if (command.liters !== undefined && Number(command.liters) !== Number(live.liters)) throw fixed('liters');
  if (command.odometerKm !== undefined && command.odometerKm !== live.odometerKm) throw fixed('odometerKm');
}
