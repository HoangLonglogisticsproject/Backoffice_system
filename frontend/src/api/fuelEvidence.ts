import { httpClient } from './client';
import type { FuelCandidate, FuelEvidence, FuelMatchResult, FuelReceiptQuery, FuelTransactionView } from '@/types/fuel';

/**
 * Fuel receipts onto costs that already exist (`cost.import`, contract §31).
 *
 * ★ NO CREATE. There is no call here that makes a cost: a receipt goes onto
 * the one cost row a person picked, through that row's own ledger route.
 */

/** Stages one image of the receipt. ★ multipart: the JSON default would serialise the form. */
export async function stageFuelEvidence(file: File): Promise<FuelEvidence> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await httpClient.post<FuelEvidence>('/fuel-evidence', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/** Drops a staged image of one's own. */
export async function discardFuelEvidence(id: string): Promise<void> {
  await httpClient.post(`/fuel-evidence/${encodeURIComponent(id)}/discard`);
}

/** Read-only: the costs on both ledgers this receipt may already be. */
export async function findFuelMatches(
  vehicleId: string,
  receipt: FuelReceiptQuery,
  evidenceIds: readonly string[],
): Promise<FuelMatchResult> {
  const { data } = await httpClient.get<FuelMatchResult>(`/trip-vehicles/${encodeURIComponent(vehicleId)}/fuel-matches`, {
    params: { ...receipt, ...(evidenceIds.length > 0 ? { evidence: evidenceIds.join(',') } : {}) },
  });
  return data;
}

/** What goes onto the picked cost: images, the receipt's facts, and the other fills seen and confirmed different. */
export interface FuelAttachment {
  evidenceIds: readonly string[];
  facts: Omit<FuelReceiptQuery, 'businessDate' | 'amount'>;
  acknowledgedMatches: readonly string[];
  /** The searched lorry and day — a trip line's fill takes them the first time. */
  vehicleId: string;
  businessDate: string;
}

/**
 * Attaches through the picked cost's OWN ledger. A lorry cost owns its liters,
 * so they are never sent there; a trip line's fill takes them as a fact, and
 * takes the lorry and day only when it is opened.
 */
export async function attachFuelReceipt(target: FuelCandidate, attachment: FuelAttachment): Promise<FuelTransactionView> {
  const { liters, ...facts } = attachment.facts;
  const common = {
    ...facts,
    evidence: attachment.evidenceIds.map((id) => ({ id })),
    acknowledgedMatches: attachment.acknowledgedMatches,
  };
  const { costId } = target.backing;
  if (target.backing.ledger === 'vehicle') {
    const { data } = await httpClient.post<FuelTransactionView>(
      `/trip-vehicles/${encodeURIComponent(target.vehicle?.id ?? '')}/costs/${encodeURIComponent(costId)}/fuel-transaction`,
      common,
    );
    return data;
  }
  const opening = target.fuelTransactionId ? {} : { vehicleId: attachment.vehicleId, businessDate: attachment.businessDate };
  const { data } = await httpClient.post<FuelTransactionView>(
    `/trip-schedules/${encodeURIComponent(target.trip?.id ?? '')}/costs/${encodeURIComponent(costId)}/fuel-transaction`,
    { ...common, ...opening, ...(liters ? { liters } : {}) },
  );
  return data;
}
