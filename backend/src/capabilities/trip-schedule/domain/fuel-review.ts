import type { UserSummary } from '../../../common/types/user-summary';

/**
 * ★ A DRIVER'S FILL, CHECKED AND PAID (0038). The money is the fill's
 * `vehicle_costs` row and its facts and images are its fuel transaction; this
 * is only the workflow over them — who moved it where, when, and why — kept
 * as append-only steps. The latest step is the state.
 *
 *   submitted   the driver recorded it; Accounting has not decided
 *   needs_info  Accounting asked the driver for something (always with a reason)
 *   approved    Accounting checked it — the money is owed to the station
 *   paid        Accounting paid it, outside the system (bank app / QR), and said so
 *   rejected    Accounting refused it (always with a reason) — final
 *
 * No payment is made here and no bank detail kept; approving and paying are
 * two steps, never one.
 */
export const FUEL_REVIEW_STATUSES = ['submitted', 'needs_info', 'approved', 'paid', 'rejected'] as const;
export type FuelReviewStatus = (typeof FUEL_REVIEW_STATUSES)[number];

/** What Accounting does to a fill, and the state it leads to. */
export const ACCOUNTING_ACTIONS = {
  'request-info': 'needs_info',
  approve: 'approved',
  reject: 'rejected',
  'mark-paid': 'paid',
} as const satisfies Record<string, FuelReviewStatus>;
export type AccountingAction = keyof typeof ACCOUNTING_ACTIONS;

/** The moves 0038's trigger allows — said once more here so a refusal is a 409, not a raw error. */
const NEXT: Readonly<Record<FuelReviewStatus | 'none', readonly FuelReviewStatus[]>> = {
  none: ['submitted'],
  submitted: ['needs_info', 'approved', 'rejected'],
  needs_info: ['submitted', 'rejected'],
  approved: ['paid'],
  paid: [],
  rejected: [],
};

export const canMove = (from: FuelReviewStatus | null, to: FuelReviewStatus): boolean => NEXT[from ?? 'none'].includes(to);

/** Asking for more and refusing say why; the other steps may carry a note (a transfer reference, say). */
export const needsReason = (to: FuelReviewStatus): boolean => to === 'needs_info' || to === 'rejected';

/** The `details` codes these rules earn. */
export const REVIEW_REASON_REQUIRED = 'REASON_REQUIRED';
export const NOT_AWAITING_DRIVER = 'NOT_AWAITING_DRIVER';

/** One step of a fill's review. */
export interface FuelReviewEvent {
  seq: number;
  status: FuelReviewStatus;
  note: string | null;
  actor: UserSummary;
  at: Date;
}

/** A submitted fill as a list shows it: the money row's figures, the fill's facts, the latest step. */
export interface FuelSubmission {
  fuelTransactionId: string;
  costId: string;
  vehicle: { id: string; plate: string };
  businessDate: string;
  occurredAt: Date | null;
  recordedAt: Date;
  amount: string;
  liters: string | null;
  odometerKm: number | null;
  driver: UserSummary | null;
  vendor: { name: string | null; taxCode: string | null } | null;
  document: { series: string | null; number: string | null } | null;
  evidenceCount: number;
  status: FuelReviewStatus;
  /** The reason of the latest step, when it carries one (needs_info, rejected, a payment note). */
  statusNote: string | null;
  statusAt: Date;
}

/** What a driver reads of their own fill: no cost id, no driver — it is theirs. */
export type DriverFuelSubmission = Omit<FuelSubmission, 'costId' | 'driver'>;
