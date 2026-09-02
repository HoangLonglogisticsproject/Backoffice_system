import type { UserSummary } from './organization';

/**
 * The money on a trip.
 *
 * These mirror the backend response verbatim. Nothing here renames a field,
 * rounds a value, or invents a convenience property — a second definition of
 * what an amount is would be a second thing to keep in step with the API, and
 * the first divergence would be silent and expensive.
 */

/**
 * ★ EVERY AMOUNT BELOW IS A `string`, AND MUST STAY ONE.
 *
 * The columns are `NUMERIC(14,2)`, chosen because binary floating point cannot
 * hold `0.1` exactly and a hundred fuel lines drift by an amount nobody can
 * reproduce. The server sends them as text for that reason.
 *
 * ⚠ NEVER `Number(amount)`, AND NEVER `a + b` ON TWO OF THEM. Adding them in
 * JavaScript either concatenates two strings or silently goes through float64 —
 * both wrong, one of them invisibly. Totals come from the server, which adds
 * them in PostgreSQL. Format for display with `formatMoney`, which never parses.
 *
 * Always arrives with both decimal places: `"1500000.00"`.
 */

/**
 * The five headings the workbook's cost block has.
 *
 * There is deliberately no `other`. A sixth REAL heading would arrive as a
 * migration, an enum entry and a label together — never as a catch-all.
 */
export type TripCostCategory = 'fuel' | 'toll' | 'warehouse' | 'loading' | 'overtime';

export const TRIP_COST_CATEGORIES: readonly TripCostCategory[] = [
  'fuel',
  'toll',
  'warehouse',
  'loading',
  'overtime',
];

/**
 * What every financial record carries.
 *
 * ★ THERE IS NO `updatedAt`, AND THAT IS THE SHAPE OF THE RULE. A financial
 * record is never edited: a wrong figure is voided, with a reason, and a new
 * record replaces it. The three void fields are null together or set together.
 */
interface FinancialRecord {
  id: string;
  tripId: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
  /**
   * The author, spelled out.
   *
   * ★ A UUID CANNOT BE SHOWN TO ANYONE. `createdBy` is kept beside this because
   * an id is what code compares; `createdByUser.displayName` is what a person
   * reads. Both are needed, and neither substitutes for the other.
   */
  createdByUser: UserSummary;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/**
 * Where a declared figure is in its life.
 *
 * ★ `locked` IS NOT `immutable`. Locking is TEMPORARY — a rejected completion
 * reopens every line back to `editable`. Only approval makes a figure permanent.
 * A backoffice line is born `immutable`: it never passes through a completion
 * request at all.
 */
export type TripCostState = 'editable' | 'locked' | 'immutable';

/** Which channel typed a figure. Not derivable from `createdBy`. */
export type TripCostSource = 'driver_portal' | 'backoffice';

/** One line of what running our own lorry cost. */
export interface TripCost extends FinancialRecord {
  category: TripCostCategory;
  amount: string;

  state: TripCostState;
  source: TripCostSource;

  /** The turn at the wheel that declared this. `null` for a backoffice line. */
  driverAssignmentId: string | null;

  /**
   * What was true when the figure was written.
   *
   * ★ NEVER RE-READ FROM THE TRIP. `vehicleOwnership` is `null` wherever nobody
   * has classified the lorry, and that must never be read as `company`.
   */
  vehicleId: string | null;
  vehicleOwnership: 'company' | 'outsourced' | null;

  /** When a completion request froze it. A rejection clears both. */
  lockedAt: string | null;
  lockedBy: string | null;
}

/** What we agreed to pay somebody else's lorry for one run. */
export interface OutsourceHire extends FinancialRecord {
  /** As typed. There is no carrier catalogue yet — the shape is not settled. */
  carrierName: string;
  agreedAmount: string;
  /** Whether the agreed figure already contains VAT. A record, not a calculation. */
  amountIncludesVat: boolean;
  documentRef: string | null;
}

/**
 * A trip's money, totalled by the server.
 *
 * `combined` is sent rather than derived so a client never adds the other two.
 */
export interface TripCostTotals {
  costs: string;
  hires: string;
  combined: string;
}

/** What the two list endpoints return: the records, and their live total. */
export interface TripCostList<T> {
  items: T[];
  /** Live records only — a voided one is never counted, whatever `items` holds. */
  total: string;
}
