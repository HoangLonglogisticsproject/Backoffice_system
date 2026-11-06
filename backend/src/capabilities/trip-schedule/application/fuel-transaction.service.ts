import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { businessToday } from '../../../common/pagination/date-range-page-query.dto';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { EvidenceAttachment } from '../domain/fuel-evidence';
import { READING_KEYS, type FuelFactsInput } from '../domain/fuel-transaction';
import type { FuelTransactionView } from '../domain/fuel-transaction-view';
import { FuelEvidenceRepository, publicEvidence } from '../persistence/fuel-evidence.repository';
import { FuelTransactionRepository, type StoredFuelTransaction } from '../persistence/fuel-transaction.repository';
import { FuelTransactionViewRepository, type FuelViewRecord } from '../persistence/fuel-transaction-view.repository';
import { FuelTransactionWriter, normalized, refuseChangedFixedFields } from './fuel-transaction-writer';

export interface RecordFuelCommand {
  facts: FuelFactsInput;
  evidence: readonly EvidenceAttachment[];
  /** Other fills the caller saw holding this receipt, and confirms are different fills. */
  acknowledgedMatches?: readonly string[];
}

/**
 * A trip line has no lorry of its own — the office names it, and the day, the
 * first time. Its readings travel in `facts`: added once each, like the rest.
 */
export interface RecordTripFuelCommand extends RecordFuelCommand {
  vehicleId?: string;
  businessDate?: string;
}

const notLive = () => new ConflictError('Only a live fuel cost takes a fuel transaction.');

/**
 * ★ `cost.import` OPENS FILLS, NOT LEDGERS — on either ledger. A cost that is
 * not fuel and was never wrapped has no fuel view: 404, as if absent, so a
 * toll or repair line is never read through this key. (A wrapped line later
 * re-headed stays readable, flagged `noLongerFuel`.)
 */
const fuelOnly = (record: FuelViewRecord | null): FuelViewRecord => {
  if (!record || (!record.fuelTransactionId && record.category !== 'fuel')) {
    throw new NotFoundError('Fuel cost not found.');
  }
  return record;
};

/**
 * ★ RECORD WHAT IS KNOWN ABOUT ONE FILL, ON ITS ONE MONEY ROW (0037). Each
 * command locks the backing cost, opens its fuel transaction if it has none,
 * adds the facts it brings field by field, and attaches the caller's staged
 * images — one transaction, so a refusal anywhere leaves nothing behind. The
 * cost row itself is never written: wrapping is not editing money.
 */
@Injectable()
export class FuelTransactionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly transactions: FuelTransactionRepository,
    private readonly views: FuelTransactionViewRepository,
    private readonly evidence: FuelEvidenceRepository,
    private readonly writer: FuelTransactionWriter,
  ) {}

  async recordOnVehicleCost(vehicleId: string, costId: string, command: RecordFuelCommand, by: string): Promise<FuelTransactionView> {
    const facts = normalized(command.facts);
    // A lorry cost already holds its liters and odometer; a second copy could disagree.
    const readings = READING_KEYS.filter((key) => facts[key] !== undefined).map((key) => [key, 'ON_THE_COST']);
    if (readings.length > 0) throw new ValidationError('A lorry cost holds its own readings.', Object.fromEntries(readings));
    await this.db.transaction(async (tx) => {
      const cost = await this.transactions.lockVehicleCost(vehicleId, costId, tx);
      if (!cost) throw new NotFoundError('Vehicle cost not found.');
      if (cost.voided || cost.category !== 'fuel') throw notLive();
      const stored =
        (await this.transactions.lockLive('vehicle_cost_id', cost.id, tx)) ??
        (await this.writer.open(
          { vehicleId: cost.vehicleId, businessDate: cost.businessDate, vehicleCostId: cost.id, tripCostId: null },
          cost.source === 'driver_portal' ? cost.createdBy : null,
          by,
          tx,
        ));
      await this.writer.complete(stored, { ...command, facts }, by, tx);
    });
    return this.viewOfVehicleCost(vehicleId, costId);
  }

  async recordOnTripCost(tripId: string, costId: string, command: RecordTripFuelCommand, by: string): Promise<FuelTransactionView> {
    const facts = normalized(command.facts);
    await this.db.transaction(async (tx) => {
      const cost = await this.transactions.lockTripCost(tripId, costId, tx);
      if (!cost) throw new NotFoundError('Trip cost not found.');
      if (cost.voided || cost.category !== 'fuel') throw notLive();
      const live = await this.transactions.lockLive('trip_cost_id', cost.id, tx);
      if (live) refuseChangedFixedFields(live, command);
      const stored = live ?? (await this.openOnTrip(cost, command, by, tx));
      await this.writer.complete(stored, { ...command, facts }, by, tx);
    });
    return this.viewOfTripCost(tripId, costId);
  }

  async viewOfVehicleCost(vehicleId: string, costId: string): Promise<FuelTransactionView> {
    return this.withEvidence(fuelOnly(await this.views.ofVehicleCost(vehicleId, costId)));
  }

  async viewOfTripCost(tripId: string, costId: string): Promise<FuelTransactionView> {
    return this.withEvidence(fuelOnly(await this.views.ofTripCost(tripId, costId)));
  }

  /**
   * ★ THE LORRY IS THE OFFICE'S EXPLICIT CHOICE — never inferred from the trip.
   * It must be the lorry the line names when it names one; otherwise one the
   * trip records (a multi-lorry trip's NULL-lorry line belongs to the ONE lorry
   * chosen here). A trip recording no lorry at all takes the choice as given.
   */
  private async openOnTrip(
    cost: { id: string; tripId: string; vehicleId: string | null; provenanceDriver: string | null },
    command: RecordTripFuelCommand,
    by: string,
    tx: DatabaseQuery,
  ): Promise<StoredFuelTransaction> {
    const { vehicleId, businessDate } = command;
    if (!vehicleId || !businessDate) {
      throw new ValidationError('A trip fuel line needs its lorry and day the first time.', {
        ...(vehicleId ? {} : { vehicleId: 'REQUIRED' }),
        ...(businessDate ? {} : { businessDate: 'REQUIRED' }),
      });
    }
    if (businessDate > businessToday(new Date())) {
      throw new ValidationError('A fill cannot be dated in the future.', { businessDate: 'IN_THE_FUTURE' });
    }
    if (!(await this.transactions.vehicleExists(vehicleId, tx))) {
      throw new ValidationError('That lorry does not exist.', { vehicleId: 'NOT_FOUND' });
    }
    if (cost.vehicleId && cost.vehicleId !== vehicleId) {
      throw new ValidationError('That trip cost names another lorry.', { vehicleId: 'NOT_THE_COSTS_LORRY' });
    }
    if (!cost.vehicleId) {
      const lorries = await this.transactions.tripLorries(cost.tripId, tx);
      if (lorries.length > 0 && !lorries.includes(vehicleId)) {
        throw new ValidationError('That lorry is not on the trip.', { vehicleId: 'NOT_ON_TRIP' });
      }
    }
    // Readings come in `complete`, as logged facts: the opener's carry a who-and-when too.
    return this.writer.open(
      { vehicleId, businessDate, vehicleCostId: null, tripCostId: cost.id },
      cost.provenanceDriver,
      by,
      tx,
    );
  }

  private async withEvidence({ category: _category, ...record }: FuelViewRecord): Promise<FuelTransactionView> {
    const evidence = record.fuelTransactionId ? await this.evidence.listByTransaction(record.fuelTransactionId) : [];
    return { ...record, evidence: evidence.map(publicEvidence) };
  }
}
