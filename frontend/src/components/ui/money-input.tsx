import * as React from 'react';

import { Input } from '@/components/ui/input';
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
  const display = formatWithCommas(value);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  /** Where the caret belongs, counted in PLAIN characters — see below. */
  const caretRef = React.useRef<number | null>(null);

  /**
   * ★ PUTTING THE CARET BACK, MEASURED IN CHARACTERS THAT ARE REALLY THERE.
   *
   * Re-formatting on every keystroke rewrites the whole value, and a rewritten
   * value sends the caret to the end — so editing the middle of an amount
   * becomes impossible: every digit typed jumps you back to the end. Restoring
   * a raw offset does not work either, because inserting a digit can also
   * insert a comma and shift everything right of it.
   *
   * So the position is remembered as a count of NON-SEPARATOR characters, which
   * is the one measure grouping cannot change, and translated back into display
   * coordinates once the formatted string exists.
   */
  React.useLayoutEffect(() => {
    const target = inputRef.current;
    if (!target) return;

    if (target.value !== display) target.value = display;

    const plainCaret = caretRef.current;
    if (plainCaret === null) return;
    caretRef.current = null;

    let seen = 0;
    let position = display.length;
    for (let index = 0; index < display.length; index += 1) {
      if (seen === plainCaret) {
        position = index;
        break;
      }
      if (display[index] !== ',') seen += 1;
    }

    target.setSelectionRange(position, position);
  });

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    const raw = target.value;
    const caret = target.selectionStart ?? raw.length;

    let plain = stripCommas(raw);
    let plainCaret = countPlain(raw, caret);

    /**
     * ★ BACKSPACE ON A SEPARATOR DELETES THE DIGIT, NOT THE COMMA.
     *
     * A comma is not a character anybody typed, so removing one leaves the
     * number identical and the formatter simply puts it back. Left alone that
     * reads as a broken key: the caret sits after `1,` and Backspace does
     * nothing, forever. Deleting what the person actually meant is both the
     * expected behaviour and the only one that terminates.
     */
    if (plain === value && raw.length < display.length && plainCaret > 0) {
      plain = plain.slice(0, plainCaret - 1) + plain.slice(plainCaret);
      plainCaret -= 1;
    }

    caretRef.current = plainCaret;

    /**
     * An edit that leaves the plain value untouched — deleting the leading
     * separator of all things — produces no state change, so React re-renders
     * nothing and the stripped text would sit in the DOM unformatted. Put the
     * display back by hand; there is no render coming to do it.
     */
    if (plain === value) {
      caretRef.current = null;
      target.value = display;
      target.setSelectionRange(caret, caret);
      return;
    }

    onChange(plain);
  };

  return (
    <Input
      ref={inputRef}
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      {...props}
    />
  );
}

/** How many characters of `text` before `upTo` survive `stripCommas`. */
function countPlain(text: string, upTo: number): number {
  let count = 0;
  for (let index = 0; index < upTo && index < text.length; index += 1) {
    if (text[index] !== ',') count += 1;
  }
  return count;
}
