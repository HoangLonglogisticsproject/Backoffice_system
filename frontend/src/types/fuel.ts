import type { UserSummary } from './organization';

/**
 * Fuel receipts attached to costs that ALREADY exist (0037, PR-2 · contract §31).
 *
 * ★ NOT MONEY OF ITS OWN. A fuel transaction wraps exactly one cost row — a
 * lorry's `vehicle_costs` line or a trip's `trip_costs` fuel line — and its
 * `amount` is always that row's. Nothing here creates a cost.
 */
export type FuelLedger = 'vehicle' | 'trip';

/** `payment_qr` (0038): a picture of the station's payment QR — an image, never parsed. */
export type FuelEvidenceType = 'pump_meter' | 'timemark' | 'fuel_voucher' | 'receipt' | 'tax_invoice' | 'payment_qr';

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

/**
 * ★ A DRIVER'S FILL, CHECKED AND PAID (0038). The latest step is the state:
 * submitted → needs_info | approved | rejected; needs_info → submitted | rejected;
 * approved → paid. No payment happens in the app — `paid` records that it did.
 */
export type FuelReviewStatus = 'submitted' | 'needs_info' | 'approved' | 'paid' | 'rejected';

/** A submitted fill in a list: the money row's figures, the fill's facts, the latest step. */
export interface FuelSubmission {
  fuelTransactionId: string;
  costId: string;
  vehicle: { id: string; plate: string };
  businessDate: string;
  occurredAt: string | null;
  recordedAt: string;
  amount: string;
  liters: string | null;
  odometerKm: number | null;
  driver: UserSummary | null;
  vendor: { name: string | null; taxCode: string | null } | null;
  document: { series: string | null; number: string | null } | null;
  evidenceCount: number;
  status: FuelReviewStatus;
  /** Why it stands where it stands, when the step said (asked, refused, a payment note). */
  statusNote: string | null;
  statusAt: string;
}

export interface FuelReviewEvent {
  seq: number;
  status: FuelReviewStatus;
  note: string | null;
  actor: UserSummary;
  at: string;
}

/** What Accounting decides on: the fill, its steps, what looks like it. */
export interface FuelReviewDetail {
  status: FuelReviewStatus;
  fill: FuelTransactionView;
  history: FuelReviewEvent[];
  warnings: FuelCandidate[];
}

export type FuelReviewAction = 'request-info' | 'approve' | 'reject' | 'mark-paid';

/** A driver's own fill: no cost id, no driver — it is theirs. */
export type DriverFuelSubmission = Omit<FuelSubmission, 'costId' | 'driver'>;

export type DriverFuelSubmissionDetail = DriverFuelSubmission & {
  history: Array<{ status: FuelReviewStatus; note: string | null; at: string }>;
  evidence: FuelEvidence[];
};

/** What a driver read off the receipt and the photos they took. The lorry, the day and the money are the fill's own. */
export interface DriverReceiptInput {
  vendorName?: string;
  vendorTaxCode?: string;
  documentNumber?: string;
  evidence?: Array<{ id: string; type?: FuelEvidenceType }>;
}
