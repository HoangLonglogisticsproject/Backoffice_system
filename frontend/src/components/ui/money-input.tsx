import * as React from 'react';

import { Input } from '@/components/ui/input';
import { useFormattedInput } from '@/hooks/useFormattedInput';
import { formatWithCommas, stripCommas } from '@/utils/format';

/**
 * A money field that reads as money while it is being typed.
 *
 * ★ THE STATE IS THE PAYLOAD, THE DISPLAY IS A VIEW OF IT. `value` and
 * `onChange` speak the PLAIN decimal string — `"1500000"` — which is exactly
 * what the API takes. The commas exist only between `formatWithCommas` and the
 * DOM. A form holding this can hand its state straight to `createTripCost`
 * without remembering to strip anything, which is the point: an amount is
 * `NUMERIC(14,2)` carried as a string end to end, and a separator that leaked
 * into a payload would be refused by the server at best.
 *
 * ★ NOT `type="number"`. That control hands back a value the browser has
 * already coerced through a float — the rounding the NUMERIC column exists to
 * prevent — refuses to display a grouped value at all, and offers a spinner
 * nobody wants on a phone. `inputMode="decimal"` gives the numeric keypad and
 * leaves the text alone.
 *
 * The caret arithmetic that makes re-formatting on every keystroke survivable
 * lives in `useFormattedInput`, which the plate field uses too.
 */
export function MoneyInput({
  value,
  onChange,
  ...props
}: Readonly<
  Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
    /** A plain decimal string, e.g. `"1500000"` or `"1500000.50"`. Never a number. */
    value: string;
    /** Receives the plain decimal string, separators already removed. */
    onChange: (plain: string) => void;
  }
>) {
  const field = useFormattedInput({
    value,
    onChange,
    format: formatWithCommas,
    strip: stripCommas,
    // ⚠ EVERYTHING BUT A COMMA COUNTS. A stray letter is the caller's to show
    // back rather than this field's to swallow — `formatWithCommas` hands an
    // unrecognised value straight through, and the caret has to agree with it.
    isPlain: (char) => char !== ',',
  });

  return <Input inputMode="decimal" {...field} {...props} />;
}
