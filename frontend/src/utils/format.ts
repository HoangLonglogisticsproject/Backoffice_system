/**
 * Display formatters: money grouping, and the plate on a lorry.
 *
 * ★ WHAT EVERYTHING HERE HAS IN COMMON — it makes a stored value READABLE and
 * never changes what is stored. Each one hands back its input untouched when it
 * does not recognise the shape, because a formatter is not the place to discover
 * that its data changed.
 */

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

// ------------------------------------------------------------- the plate ----

/**
 * A Vietnamese registration plate, written the one way.
 *
 * ★ WHY THIS EXISTS. The workbook this system replaces had the plate typed into
 * the cell every time, and it accumulated `50H44266` beside `50H-49266` and
 * `51D.65233` beside `51D65233` — the same lorry, four spellings, none of them
 * findable by looking for the others. The catalogue fixed the DATA half by
 * making the plate a choice from a list. This fixes the READING half: whatever
 * spelling somebody stored, a screen shows one shape.
 *
 * ⚠ DISPLAY ONLY, AND IT MUST STAY THAT WAY. `TripVehicle.plate` is documented
 * as "as somebody typed it — display this, match on nothing", and that is still
 * true: nothing here is ever sent back to the server, used as a key, or compared
 * against another plate. Normalising on the way IN would rewrite the record;
 * this only decides how it is drawn.
 *
 * THE SHAPE: two province digits, one or two series letters, sometimes a series
 * digit after them, then the registration number.
 *
 *   50H49266     → 50H-49266
 *   51D.65233    → 51D-65233
 *   51c 4265     → 51C-4265
 *   50AA-123646  → 50AA-123646   (already right; idempotent)
 */

/** Everything people actually type between the two halves. */
const PLATE_SEPARATORS = /[\s.\-_]+/;

/**
 * The plate with every separator gone and the letters upper-cased — the form
 * that is STORED and sent.
 *
 * ★ IT MIRRORS `plate_key` EXACTLY. 0011 generates that column as
 * `upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))` and makes it the
 * unique index, so this is not a spelling this client invented: it is the one
 * the database already considers canonical. Sending it means the value stored
 * and the value matched on are the same string, and the four spellings the
 * workbook accumulated cannot come back.
 *
 * ★ AND IT IS THE INVERSE OF {@link formatPlate}, the way `stripCommas` is of
 * `formatWithCommas`: state holds this, the display shows the formatted view,
 * and only this ever reaches a payload.
 *
 * ⚠ IT DISCARDS WHERE THE TYPIST PUT THE BREAK. For a lorry that costs nothing
 * — `formatPlate` puts it back in the same place. For a MOTORBIKE plate, whose
 * series carries a digit (`59X1-12345`), the break is the only thing that says
 * so, and reading it back gives `59X-112345`. This deployment registers lorries;
 * if motorbikes are ever added, the stored value has to keep its separator.
 */
export function stripPlate(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * The two halves, once the separators are gone.
 *
 * ★ `\d??` IS LAZY, AND IT HAS TO BE. Greedy, the series digit swallows the
 * first digit of the number whenever the number is short: `50H49266` reads as
 * `50H4` + `9266`, because a 4-digit tail satisfies the pattern just as well as
 * a 5-digit one. That is the commonest plate on this board, misfiled on every
 * screen. Lazy takes the digit ONLY when the number would otherwise be too long
 * to be one — which is exactly when a series digit is really there.
 */
const PLATE_SHAPE = /^(\d{2}[A-Z]{1,2}\d??)(\d{4,6})$/;

const PLATE_HEAD = /^\d{2}[A-Z]{1,2}\d?$/;
const PLATE_TAIL = /^\d{4,6}$/;

/**
 * `50H49266` → `50H-49266`. Anything unrecognised comes back trimmed and
 * otherwise untouched.
 *
 * ★ AN EXISTING SEPARATOR WINS, AND THAT IS THE WHOLE CARE IN THIS FUNCTION.
 * Stripped of punctuation, `59X112345` is genuinely ambiguous — `59X-112345`
 * for a lorry, `59X1-12345` for a motorbike — and no rule can tell them apart,
 * because both are real plates. So when whoever typed it already said where the
 * break goes, that answer is kept; the rule below only decides for input that
 * never carried one. A formatter that guessed would rename one vehicle in every
 * batch and be right often enough that nobody checked.
 *
 * Idempotent: its own output has a separator in the position it just chose, so
 * feeding the result back in is a no-op. That matters — these values are
 * re-rendered on every keystroke elsewhere on the page.
 *
 * @param raw the stored plate, in whatever spelling it was saved as
 */
export function formatPlate(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';

  const trimmed = raw.trim();
  if (trimmed === '') return '';

  const upper = trimmed.toUpperCase();
  // Where the typist put the break, as a position in the stripped string. `-1`
  // when they gave none. Measured BEFORE stripping, because that count is the
  // only record of their intent.
  const breakAt = upper.search(PLATE_SEPARATORS);
  const stripped = upper.split(PLATE_SEPARATORS).join('');

  // Not a plate this function knows how to read: a foreign one, a trailer code,
  // half of one still being typed. Hand back what came in — silently reshaping
  // something unrecognised is how a display turns into a lie.
  if (!PLATE_SHAPE.test(stripped)) return trimmed;

  if (breakAt > 0) {
    const head = stripped.slice(0, breakAt);
    const tail = stripped.slice(breakAt);
    // Only honoured when it lands somewhere a break can go. `50 H 49266` breaks
    // after `50`, which is not a head — that separator was spacing, not a split.
    if (PLATE_HEAD.test(head) && PLATE_TAIL.test(tail)) return `${head}-${tail}`;
  }

  // No usable separator: the letters end the head. Non-null by the test above.
  const [, head, tail] = PLATE_SHAPE.exec(stripped) as RegExpExecArray;
  return `${head}-${tail}`;
}
