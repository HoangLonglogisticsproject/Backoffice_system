/**
 * Grouping digits for reading, with a comma every three.
 *
 * ★ NEVER PARSES, AND IT IS NOT AN OPTIONAL HABIT HERE. Amounts live in a
 * `NUMERIC(14,2)` column precisely because floats cannot hold decimals, and
 * they travel as strings for the same reason. `Number("1500000.00")` happens to
 * be exact, which is what makes it dangerous: it works right up to the figure
 * where it does not. Everything below is string work.
 *
 * ★ IT ALSO RUNS ON EVERY KEYSTROKE. `MoneyInput` calls it while somebody is
 * still typing, so it has to survive a half-written number — a trailing point,
 * a fraction that is still `0`, an already-grouped value coming back round.
 * Anything it does not recognise is handed back untouched rather than mangled:
 * a formatter is not the place to discover that its input changed shape.
 */

/**
 * Inserts a `,` every three digits, from the right.
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
    out = out === '' ? chunk : `${chunk},${out}`;
  }
  return out;
};

/**
 * Removes the display separators, giving back the plain decimal string the
 * server expects. The inverse of {@link formatWithCommas}, and the only thing
 * that should ever reach an API payload.
 */
export function stripCommas(value: string): string {
  return value.split(',').join('');
}

/**
 * `1500000` → `1,500,000`. The decimal point is left as a point, and the
 * fraction is passed through exactly as it was typed — trailing zeros and a
 * lone trailing `.` included, because eating either would fight the person
 * mid-keystroke.
 *
 * Idempotent by construction: separators are stripped before grouping, so
 * feeding the result back in is a no-op. That is load-bearing — a controlled
 * input re-formats its own value on every render.
 */
export function formatWithCommas(value: string | number): string {
  const raw = typeof value === 'number' ? String(value) : value;
  const plain = stripCommas(raw.trim());
  if (plain === '') return '';

  const point = plain.indexOf('.');
  const whole = point === -1 ? plain : plain.slice(0, point);
  const fraction = point === -1 ? null : plain.slice(point + 1);

  // A negative, a second point, a stray letter, an exponent — none of them are
  // shapes this grouping means anything for. Hand the original back so the
  // caller can see what it actually has.
  if (!/^\d*$/.test(whole) || (fraction !== null && !/^\d*$/.test(fraction))) {
    return raw;
  }

  const grouped = group(whole);

  return fraction === null ? grouped : `${grouped}.${fraction}`;
}
