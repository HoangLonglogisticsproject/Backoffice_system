import type { UserSummary } from './organization';

/**
 * Fuel receipts attached to costs that ALREADY exist (0037, PR-2 · contract §31).
 *
 * ★ NOT MONEY OF ITS OWN. A fuel transaction wraps exactly one cost row — a
 * lorry's `vehicle_costs` line or a trip's `trip_costs` fuel line — and its
 * `amount` is always that row's. Nothing here creates a cost.
 */
export type FuelLedger = 'vehicle' | 'trip';

export type FuelEvidenceType = 'pump_meter' | 'timemark' | 'fuel_voucher' | 'receipt' | 'tax_invoice';

export interface FuelEvidence {
  id: string;
  sha256: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
  originalFilename: string | null;
  evidenceType: FuelEvidenceType | null;
  capturedAt: string | null;
  uploadedBy: UserSummary;
  uploadedAt: string;
  /** `null` while staged — uploaded, not yet on a fill. */
  fuelTransactionId: string | null;
  attachedAt: string | null;
  retiredAt: string | null;
  retireReason: string | null;
}

export type FuelTransactionFlag = 'backingVoided' | 'noLongerFuel' | 'editedAfterEvidence' | 'vehicleConfirmedOnlyByEvidence';

/** One fill, whichever ledger backs it. `fuelTransactionId: null` = the cost has no fill yet. */
export interface FuelTransactionView {
  fuelTransactionId: string | null;
  backing: { ledger: FuelLedger; costId: string; source: 'driver_portal' | 'backoffice'; voided: boolean };
  vehicle: { id: string; plate: string } | null;
  businessDate: string | null;
  occurredAt: string | null;
  recordedAt: string;
  amount: string;
  liters: string | null;
  odometerKm: number | null;
  unitPrice: string | null;
  driver: UserSummary | null;
  vendor: { name: string | null; taxCode: string | null } | null;
  document: { series: string | null; number: string | null } | null;
  /** The owning trip for a trip line; provenance for a lorry cost. */
  trip: { id: string; scheduledOn: string; customerName: string | null } | null;
  flags: FuelTransactionFlag[];
  recordedBy: UserSummary;
  evidence: FuelEvidence[];
}

/** exact = same image on that fill · high = same tax code + number · possible = same lorry, amount, ±1 day. */
export type FuelMatchLevel = 'exact' | 'high' | 'possible';
export type FuelMatchBasis = 'evidence_hash' | 'document_identity' | 'fingerprint';

export type FuelCandidate = Omit<FuelTransactionView, 'evidence'> & {
  evidenceCount: number;
  level: FuelMatchLevel | null;
  basis: FuelMatchBasis[];
  /** Receipt facts the fill already holds differently — the server would refuse them. */
  conflicts: string[];
};

/** `none` — nothing records this receipt; this screen creates nothing. */
export interface FuelMatchResult {
  outcome: 'none' | 'single' | 'ambiguous';
  matches: FuelCandidate[];
  dayRows: FuelCandidate[];
}

/** The receipt in hand. Amount and day always; the rest when legible. */
export interface FuelReceiptQuery {
  businessDate: string;
  amount: string;
  liters?: string;
  vendorName?: string;
  vendorTaxCode?: string;
  documentSeries?: string;
  documentNumber?: string;
}
