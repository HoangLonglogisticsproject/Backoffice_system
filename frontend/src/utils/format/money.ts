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

/**
 * Inserts a `.` every three digits, from the right.
 *
 * ★ A LOOP RATHER THAN A LOOKAHEAD REGEX. The obvious spelling is
 * `/\B(?=(\d{3})+(?!\d))/g`, and it is the one to avoid: a `+` wrapped around a
 * fixed-width group makes the matcher try every grouping of the digits before
 * settling, so its cost grows super-linearly with the length of the number.
 * Money is attacker-influenced input in the general case, and a formatter is a
 * silly place to spend that. Walking the string backwards in threes is linear,
 * obvious, and needs no regex engine at all.
 */
const group = (digits: string): string => {
  let out = '';
  for (let end = digits.length; end > 0; end -= 3) {
    const chunk = digits.slice(Math.max(0, end - 3), end);
    out = out === '' ? chunk : `${chunk}.${out}`;
  }
  return out;
};

export function formatMoney(amount: string): string {
  const trimmed = amount.trim();
  if (trimmed === '') return '';

  const [whole = '', fraction] = trimmed.split('.');

  // Anything that is not a plain decimal is handed back untouched rather than
  // mangled: the server is the authority on what it sent, and a formatter is
  // not the place to discover a contract change.
  if (!/^\d+$/.test(whole)) return trimmed;

  const grouped = group(whole);

  return fraction && /[1-9]/.test(fraction) ? `${grouped},${fraction}` : grouped;
}
