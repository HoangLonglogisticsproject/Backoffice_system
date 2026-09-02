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

/**
 * Adds decimal money strings EXACTLY, without ever touching a float.
 *
 * ★ THE WHOLE FILE EXISTS TO AVOID `Number()`, AND SO DOES THIS.
 *
 * `NUMERIC(14,2)` was chosen because binary floating point cannot hold `0.1`.
 * Summing a driver's fuel lines through `parseFloat` would be right for small
 * figures and wrong for the ones that matter — the worst failure mode there is,
 * because nothing looks broken.
 *
 * So the strings are split at the point and added as integer MINOR UNITS via
 * `BigInt`, which has no rounding at all. `14` digits of precision is far
 * inside what `BigInt` handles.
 *
 * ⚠ ONLY FOR FIGURES THE VIEWER MAY ALREADY SEE. This adds what is on screen;
 * it is not a way to reconstruct a total the server deliberately withheld — a
 * trip's real total includes the price agreed with a hired carrier, which is
 * never sent to a driver and cannot be summed from lines they do not have.
 *
 * Returns the same shape the server sends: two decimal places, always.
 */
export function sumMoney(amounts: readonly string[]): string {
  const total = amounts.reduce((running, amount) => running + toMinorUnits(amount), 0n);

  const sign = total < 0n ? '-' : '';
  const absolute = total < 0n ? -total : total;
  const major = absolute / 100n;
  const minor = absolute % 100n;

  return `${sign}${major}.${minor.toString().padStart(2, '0')}`;
}

/** `"1500000.5"` → `150000050n`. Tolerates 0, 1 or 2 decimal places. */
function toMinorUnits(amount: string): bigint {
  const [major = '0', minor = ''] = amount.trim().split('.');
  // Padded then truncated: the column holds two places, and a third would have
  // been refused long before it reached here.
  const cents = `${minor}00`.slice(0, 2);

  return BigInt(major) * 100n + BigInt(cents);
}
