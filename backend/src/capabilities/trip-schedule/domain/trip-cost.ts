import type { UserSummary } from '../../../common/types/user-summary';
import type { TripCostSource, TripCostState, VehicleOwnership } from './trip-execution';

/**
 * The money a trip cost, as data.
 *
 * PROJECT-OWNED, and the second half of what the workbook held: 0011 recorded
 * the dispatch board, 0012 recorded the CHI PHÍ block beside it.
 *
 * ★ TWO KINDS OF MONEY-OUT, AND THEY ARE NOT ONE TYPE. Running our own lorry
 * accumulates MANY lines — fuel, then tolls, then overtime, each bought on a
 * separate occasion. Buying somebody else's lorry is ONE agreed price with a
 * counterparty named on it, and the carrier absorbs their own fuel into it.
 * A single type covering both would carry a carrier field meaningless for five
 * of six values.
 *
 * ★ NOTHING HERE IS MONEY-IN. Amounts recharged to a customer are a different
 * direction and a different workflow; modelling one as a negative cost would
 * corrupt every total these types exist to produce.
 */

/**
 * ★ EVERY AMOUNT IN THIS FILE IS A `string`, AND THAT IS THE MOST IMPORTANT
 * FACT IN IT.
 *
 * The columns are `NUMERIC(14,2)`, chosen because binary floating point cannot
 * hold `0.1` and a hundred fuel lines drift by an amount nobody can reproduce.
 * `pg` hands `NUMERIC` back as a STRING for exactly that reason — verified, not
 * assumed — and the moment one becomes a `number` the precision the column was
 * chosen for is gone, silently, on the way out of the repository.
 *
 * So it stays text the whole way: text in the row, text in the domain, text in
 * the JSON. Totals are computed by PostgreSQL with `SUM`, never by adding them
 * in JavaScript. If a caller needs arithmetic, that arithmetic belongs in SQL
 * or in a decimal library — never in `+`.
 *
 * Always rendered by PostgreSQL with both decimal places: `"1000000.00"`.
 */

/**
 * A positive amount that `NUMERIC(14,2)` can hold exactly.
 *
 * Up to 12 digits before the point and at most 2 after, which is precisely what
 * a precision of 14 with a scale of 2 accepts — a longer fraction would be
 * ROUNDED by PostgreSQL rather than refused, and a client would be told its
 * figure was stored when a different figure was stored.
 *
 * No sign is permitted at all, so `-0` and `-1` fail here rather than at the
 * CHECK constraint. At least one non-zero digit is required, which is how
 * "greater than zero" is expressed without ever parsing the value as a number.
 */
const RECORDABLE_AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

export const isRecordableAmount = (value: string): boolean =>
  RECORDABLE_AMOUNT.test(value) && /[1-9]/.test(value);

/**
 * ★ THE FIVE HEADINGS THE WORKBOOK'S COST BLOCK HAS, AND NO SIXTH.
 *
 * There is deliberately no `other`. A catch-all bucket is where a taxonomy goes
 * to die: everything anybody is unsure about lands in it, and within a year the
 * five named values describe a minority of the spending. A sixth REAL heading
 * is welcome — as a sixth named value, added on purpose, in the enum, the CHECK
 * constraint and the labels together.
 */
export const TRIP_COST_CATEGORIES = [
  /** DẦU */
  'fuel',
  /** CẦU TRẠM */
  'toll',
  /** PHÍ KHO */
  'warehouse',
  /** BỐC XẾP */
  'loading',
  /** TĂNG CA */
  'overtime',
] as const;

export type TripCostCategory = (typeof TRIP_COST_CATEGORIES)[number];

/**
 * What every financial record here carries, whichever kind it is.
 *
 * ★ THERE IS NO `updatedAt`, AND THAT IS THE SHAPE OF THE RULE. A financial
 * record is never edited: a wrong figure is VOIDED, with a reason, and a new
 * record replaces it — so what was believed on Tuesday is still readable on
 * Friday. The three void fields move together or not at all, which the database
 * enforces as well (`*_void_state`), because a withdrawal with no reason is the
 * record somebody comes back to and cannot explain.
 */
interface FinancialRecord {
  id: string;
  /** The trip this money belongs to. Never changes. */
  tripId: string;
  note: string | null;

  createdBy: string;
  createdAt: Date;

  /**
   * The author, spelled out.
   *
   * ★ A UUID CANNOT BE SHOWN TO ANYONE — `user-summary` states the rule, and a
   * financial record is where it matters most: "who entered this" is the second
   * question asked of any figure. `createdBy` is kept beside it because callers
   * compare ids, never names.
   */
  createdByUser: UserSummary;

  /** All three are null together, or all three are set together. */
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/**
 * One line of what running our own lorry cost.
 *
 * ★ THE LIFECYCLE FIELDS BELOW ARE WHY THIS TYPE OUTGREW ITS ORIGINAL SHAPE.
 * A clerk's invoice line is final the moment it is typed; a driver's figure,
 * entered on a phone at a fuel station, is not. Both live here, and `state` and
 * `source` are what tell them apart — see `trip-execution.ts` for the argument.
 */
export interface TripCost extends FinancialRecord {
  category: TripCostCategory;
  amount: string;

  /** `editable` → `locked` → `immutable`. A backoffice line starts `immutable`. */
  state: TripCostState;
  /** Which channel typed it. NOT derivable from `createdBy`. */
  source: TripCostSource;

  /** The turn at the wheel that declared this. `null` for a backoffice line. */
  driverAssignmentId: string | null;

  /**
   * What was true when the figure was written.
   *
   * ★ NEVER RE-READ FROM THE TRIP. The trip's vehicle today may not be the one
   * this money was spent on, and `vehicleOwnership` is `null` wherever the
   * classification has not been made — which must never be read as `company`.
   */
  vehicleId: string | null;
  vehicleOwnership: VehicleOwnership | null;

  /** When the line was frozen by a completion request. Temporary; a rejection clears it. */
  lockedAt: Date | null;
  lockedBy: string | null;
}

/**
 * What we agreed to pay somebody else's lorry for one run.
 *
 * ★ THE CARRIER IS A NAME, NOT AN ID, AND THAT IS ON PURPOSE FOR NOW. The
 * names in the real data — `Hai Thành`, `Hải Râu`, `xe Út`, `Mr Đạt` — are a
 * company, a nickname, somebody's lorry and a person. A catalogue built before
 * that is settled would have to pick between carrier, vehicle and driver, and
 * picking wrong points every row at the wrong kind of thing. The name as typed
 * is the one fact that is certainly true, and the one that cannot be recovered
 * if it is thrown away.
 */
export interface OutsourceHire extends FinancialRecord {
  carrierName: string;
  agreedAmount: string;
  /**
   * Whether `agreedAmount` already contains VAT.
   *
   * ⚠ A RECORD, NOT A CALCULATION. Nothing here computes VAT, reclaims it or
   * reports it — that has not been specified. This only preserves what the
   * figure MEANS, so that a gross price entered into a system assuming net
   * cannot silently make every total wrong by a tenth.
   */
  amountIncludesVat: boolean;
  /** The invoice or contract the price came from, as written on it. */
  documentRef: string | null;
}

/**
 * A trip's money, totalled.
 *
 * ★ EVERY FIGURE COMES FROM `SUM()` IN POSTGRESQL. Adding the strings above in
 * JavaScript would mean parsing them into floats, which is the one thing
 * `NUMERIC` was chosen to prevent. `combined` is therefore computed in SQL too,
 * rather than by adding `costs` and `hires` here.
 *
 * Voided records are excluded from all three.
 */
export interface TripCostTotals {
  /** Live `trip_costs` lines. */
  costs: string;
  /** Live `trip_outsource_hires`. */
  hires: string;
  /** Both, because a caller must never add the two above itself. */
  combined: string;
}
