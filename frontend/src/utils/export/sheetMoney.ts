/**
 * An amount as a spreadsheet NUMBER — the one place this app parses money, and
 * deliberately.
 *
 * Everywhere else an amount stays a string end to end, because `NUMERIC(14,2)`
 * through float64 is how a figure changes without anything on the wire showing
 * it did. A spreadsheet is the exception that earns it: a column of text is a
 * column nobody can sum, and summing these columns is most of why anybody
 * exports the board at all.
 *
 * Safe for what this business records: VND amounts of at most 12 digits and 2
 * decimals, which a double — what Excel itself stores — holds for display and
 * summing. A missing amount is `null`, never `0`: an empty cell and a zero are
 * different claims, and a `0` would drag any average taken over the column.
 *
 * Moved here from `tripScheduleSheet` when the cost columns needed it too, so
 * prices and costs are parsed by the same rule.
 */
export const sheetMoney = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** How every money column is displayed: thousands grouped, no decimals shown. */
export const SHEET_MONEY_FORMAT = '#,##0';
