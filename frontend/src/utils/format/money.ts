/**
 * Rendering an amount that arrived as a decimal string.
 *
 * ★ NEVER PARSES. `Number("1500000.00")` would be exact today and is still the
 * wrong habit: the value comes from `NUMERIC(14,2)` precisely because floats
 * cannot hold decimals, and a formatter that parses is one refactor away from a
 * total that drifts. Everything below is string work — split on the point,
 * group the digits, put it back.
 *
 * ★ THE SEPARATORS FOLLOW THE CURRENCY, NOT THE UI LANGUAGE. Amounts are VND,
 * so thousands are grouped with `.` and the decimal is `,` whichever language
 * the screen is in — switching to English does not make the money dollars.
 *
 * VND has no subunit in daily use, so `"1500000.00"` renders as `1.500.000`.
 * A non-zero fraction is shown rather than hidden, because dropping it would
 * silently disagree with what is stored.
 */
export function formatMoney(amount: string): string {
  const trimmed = amount.trim();
  if (trimmed === '') return '';

  const [whole = '', fraction] = trimmed.split('.');

  // Anything that is not a plain decimal is handed back untouched rather than
  // mangled: the server is the authority on what it sent, and a formatter is
  // not the place to discover a contract change.
  if (!/^\d+$/.test(whole)) return trimmed;

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return fraction && /[1-9]/.test(fraction) ? `${grouped},${fraction}` : grouped;
}
