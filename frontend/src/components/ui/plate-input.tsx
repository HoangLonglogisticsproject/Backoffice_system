import * as React from 'react';

import { Input } from '@/components/ui/input';
import { formatPlate, stripPlate } from '@/utils/format';

/**
 * A registration plate field that reads as a plate while it is being typed.
 *
 * ★ THE STATE IS THE PAYLOAD, THE DISPLAY IS A VIEW OF IT — the same contract
 * `MoneyInput` keeps, and for the same reason. `value` and `onChange` speak the
 * PLAIN plate — `"50AA123333"` — which is exactly what `POST /trip-vehicles`
 * takes and exactly what 0011 computes `plate_key` to be. The dash exists only
 * between `formatPlate` and the DOM. A form holding this can hand its state
 * straight to the API without remembering to strip anything.
 *
 * ★ WHY STORE THE PLAIN FORM AT ALL. The workbook accumulated `50H44266`,
 * `50H-49266`, `51D.65233` and `51D65233` — the same two lorries, four
 * spellings, none findable by looking for the others. The database already
 * treats them as one row (`plate_key` strips punctuation for the unique index);
 * storing that same string means what is SHOWN is derived from what is MATCHED,
 * so the two can never drift apart again.
 *
 * ⚠ AND IT DISCARDS THE TYPIST'S BREAK. That is free for a lorry — the
 * formatter puts the dash back in the same place — and lossy for a motorbike,
 * whose series digit is only distinguishable BY the break. See `stripPlate`.
 */
export function PlateInput({
  value,
  onChange,
  ...props
}: Readonly<
  Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
    /** The plain plate, e.g. `"50AA123333"`. Never the formatted one. */
    value: string;
    /** Receives the plain plate: separators removed, letters upper-cased. */
    onChange: (plain: string) => void;
  }
>) {
  const display = formatPlate(value);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  /** Where the caret belongs, counted in PLAIN characters — see below. */
  const caretRef = React.useRef<number | null>(null);

  /**
   * ★ PUTTING THE CARET BACK, MEASURED IN CHARACTERS THAT ARE REALLY THERE.
   *
   * Re-formatting on every keystroke rewrites the whole value, and a rewritten
   * value sends the caret to the end — so correcting a digit in the middle of a
   * plate becomes impossible. Restoring a raw offset does not work either,
   * because typing one character can also insert the dash and shift everything
   * right of it.
   *
   * So the position is remembered as a count of NON-DASH characters, which is
   * the one measure formatting cannot change, and translated back into display
   * coordinates once the formatted string exists. Same technique as
   * `MoneyInput`, over a different separator.
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
      if (display[index] !== '-') seen += 1;
    }

    target.setSelectionRange(position, position);
  });

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    const raw = target.value;
    const caret = target.selectionStart ?? raw.length;

    let plain = stripPlate(raw);
    let plainCaret = countPlain(raw, caret);

    /**
     * ★ BACKSPACE ON THE DASH DELETES THE CHARACTER BEFORE IT, NOT THE DASH.
     *
     * Nobody typed the dash, so removing one leaves the plate identical and the
     * formatter simply puts it back. Left alone that reads as a broken key: the
     * caret sits after `50AA-` and Backspace does nothing, forever. Deleting
     * what the person actually meant is both what they expect and the only
     * behaviour that terminates.
     */
    if (plain === value && raw.length < display.length && plainCaret > 0) {
      plain = plain.slice(0, plainCaret - 1) + plain.slice(plainCaret);
      plainCaret -= 1;
    }

    caretRef.current = plainCaret;

    /**
     * An edit that leaves the plain value untouched — typing a dash the
     * formatter was going to add anyway, or a space — produces no state change,
     * so React re-renders nothing and the raw text would sit in the DOM
     * unformatted. Put the display back by hand; there is no render coming.
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
      // Plates are letters and digits, and a phone keyboard that opens on
      // letters is the right one — the province code is two taps either way.
      autoCapitalize="characters"
      autoComplete="off"
      spellCheck={false}
      value={display}
      onChange={handleChange}
      {...props}
    />
  );
}

/** How many characters of `text` before `upTo` survive `stripPlate`. */
function countPlain(text: string, upTo: number): number {
  let count = 0;
  for (let index = 0; index < upTo && index < text.length; index += 1) {
    if (/[A-Za-z0-9]/.test(text[index] as string)) count += 1;
  }
  return count;
}
