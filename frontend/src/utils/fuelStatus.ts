import type { StatusTone } from '@/components/common/StatusPill';
import type { FuelEvidenceType, FuelMatchLevel, FuelReviewStatus } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';

/** A fill's review state, in words and colour — the same on the phone and in the office. */
export const FUEL_STATUS_LABEL: Record<FuelReviewStatus, TranslationKey> = {
  submitted: 'fuelStatusSubmitted',
  needs_info: 'fuelStatusNeedsInfo',
  approved: 'fuelStatusApproved',
  paid: 'fuelStatusPaid',
  rejected: 'fuelStatusRejected',
};
export const FUEL_STATUS_TONE: Record<FuelReviewStatus, string> = {
  submitted: 'bg-sky-100 text-sky-900',
  needs_info: 'bg-amber-100 text-amber-900',
  approved: 'bg-emerald-100 text-emerald-900',
  paid: 'bg-emerald-600 text-white',
  rejected: 'bg-red-100 text-red-900',
};

/** Why a candidate looks like a receipt — the same words on the attach screen and in a review. */
export const MATCH_LEVEL: Record<FuelMatchLevel, { label: TranslationKey; tone: StatusTone }> = {
  exact: { label: 'fuelLevelExact', tone: 'red' },
  high: { label: 'fuelLevelHigh', tone: 'amber' },
  possible: { label: 'fuelLevelPossible', tone: 'blue' },
};

/** What a receipt image shows. */
export const EVIDENCE_LABEL: Record<FuelEvidenceType, TranslationKey> = {
  pump_meter: 'fuelEvidencePump',
  timemark: 'fuelEvidenceTimemark',
  fuel_voucher: 'fuelEvidenceVoucher',
  receipt: 'fuelEvidenceReceipt',
  tax_invoice: 'fuelEvidenceTaxInvoice',
  payment_qr: 'fuelEvidenceQr',
};
