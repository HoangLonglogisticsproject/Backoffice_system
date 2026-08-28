/**
 * The money on a trip.
 *
 * These mirror the backend response verbatim. Nothing here renames a field,
 * rounds a value, or invents a convenience property — a second definition of
 * what an amount is would be a second thing to keep in step with the API, and
 * the first divergence would be silent and expensive.
 */

/**
 * ★ AN AMOUNT IS A STRING, AND MUST STAY ONE.
 *
 * The column is `NUMERIC(14,2)`, chosen because binary floating point cannot
 * hold `0.1` exactly and a hundred fuel lines drift by an amount nobody can
 * reproduce. The server sends it as text for that reason.
 *
 * ⚠ NEVER `Number(amount)`, AND NEVER `a + b` ON TWO OF THESE. Adding them in
 * JavaScript either concatenates two strings or silently goes through float64 —
 * both wrong, one of them invisibly. Totals come from the server, which adds
 * them in PostgreSQL. Format for display with `formatMoney`, which never parses.
 *
 * Always arrives with both decimal places: `"1500000.00"`.
 */
export type MoneyAmount = string;

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
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/** One line of what running our own lorry cost. */
export interface TripCost extends FinancialRecord {
  category: TripCostCategory;
  amount: MoneyAmount;
}

/** What we agreed to pay somebody else's lorry for one run. */
export interface OutsourceHire extends FinancialRecord {
  /** As typed. There is no carrier catalogue yet — the shape is not settled. */
  carrierName: string;
  agreedAmount: MoneyAmount;
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
  costs: MoneyAmount;
  hires: MoneyAmount;
  combined: MoneyAmount;
}

/** What the two list endpoints return: the records, and their live total. */
export interface TripCostList<T> {
  items: T[];
  /** Live records only — a voided one is never counted, whatever `items` holds. */
  total: MoneyAmount;
}
