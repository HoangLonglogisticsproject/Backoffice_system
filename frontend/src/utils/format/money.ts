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
 *
 * ★ `null` MEANS "THIS CANNOT BE TOTALLED EXACTLY", AND IT IS NOT A ZERO.
 *
 * `BigInt('1,500,000')` throws, and this ran inside `ExpensePanel`'s render —
 * so one amount the server sent in an unexpected shape did not produce an odd
 * total, it unmounted the screen and left the driver with nothing. A formatter
 * that can blank the page is worse than no formatter.
 *
 * Skipping the bad line was the other option and is the more dangerous one: a
 * total quietly missing somebody's fuel receipt is wrong in the direction
 * nobody checks. So an exact answer or an admission — never a plausible number
 * that is not the sum. `formatMoney` already takes this line, handing back
 * anything that is not a plain decimal untouched rather than mangling it.
 */
export function sumMoney(amounts: readonly string[]): string | null {
  let total = 0n;

  for (const amount of amounts) {
    const minor = toMinorUnits(amount);
    if (minor === null) return null;
    total += minor;
  }

  return `${total / 100n}.${(total % 100n).toString().padStart(2, '0')}`;
}

/**
 * A plain non-negative decimal, which is the only thing the column can hold.
 *
 * ★ NEGATIVES ARE REFUSED RATHER THAN HANDLED. `trip_costs.amount` is
 * `CHECK (amount > 0)`, so a negative cannot arrive from the server, and
 * `formatMoney` already refuses one — its whole-part test is `^\d+$`. The
 * arithmetic here used to accept a sign and get it WRONG for anything with
 * cents: `-1.50` split to `-1` and `50` came out as `-0.50`. A branch that
 * cannot be reached and would answer wrongly if it were is worth deleting, not
 * keeping.
 */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/**
 * `"1500000.5"` → `150000050n`, or `null` if it is not a plain decimal.
 *
 * ★ VALIDATES BEFORE IT CONVERTS. `BigInt` throws on everything from a
 * thousands separator to an empty string, and a throw from here reaches the
 * caller as a blank screen rather than as a number that looks wrong.
 */
function toMinorUnits(amount: string): bigint | null {
  const trimmed = amount.trim();
  if (!PLAIN_DECIMAL.test(trimmed)) return null;

  const [major = '0', minor = ''] = trimmed.split('.');
  // Padded then truncated: the column holds two places, and a third would have
  // been refused long before it reached here.
  const cents = `${minor}00`.slice(0, 2);

  return BigInt(major) * 100n + BigInt(cents);
}
