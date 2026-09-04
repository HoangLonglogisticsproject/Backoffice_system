import * as React from 'react';

/**
 * A text field whose STATE is the payload and whose DISPLAY is a view of it.
 *
 * ★ TWO FIELDS NEEDED THE SAME MACHINERY AND ONLY THE SAME MACHINERY. An amount
 * is grouped with commas and a plate is broken with a dash; both hold the plain
 * string the API takes, both re-format on every keystroke, and both then have to
 * solve the same two problems below. Written out twice — which is how this
 * started — the copies drift, and the half that drifts is the caret arithmetic
 * nobody re-reads.
 *
 * What does NOT live here is anything either field means: how a value is
 * formatted, what survives stripping, and which characters are separators all
 * arrive as arguments. This hook knows only that SOME characters are added for
 * reading and must not be mistaken for typing.
 */
export interface FormattedInput {
  /** The payload, exactly as it would be sent. Never the formatted string. */
  value: string;
  /** Receives the payload, separators already removed. */
  onChange: (plain: string) => void;
  /** payload → what the person reads. Must be idempotent over its own output. */
  format: (plain: string) => string;
  /** what was typed → payload. */
  strip: (raw: string) => string;
  /**
   * Does this display character survive `strip`?
   *
   * ⚠ NOT "is it a separator", and the difference is real. The money field
   * counts everything that is not a comma, because a stray letter there is the
   * caller's problem to show back. The plate field counts only letters and
   * digits, because it drops a pasted `.` outright. Asking the caller keeps
   * each field's own answer.
   */
  isPlain: (char: string) => boolean;
}

/** How many characters of `text` before `upTo` survive stripping. */
const countPlain = (text: string, upTo: number, isPlain: (char: string) => boolean): number => {
  let count = 0;
  for (let index = 0; index < upTo && index < text.length; index += 1) {
    if (isPlain(text[index] as string)) count += 1;
  }
  return count;
};

export function useFormattedInput({ value, onChange, format, strip, isPlain }: FormattedInput) {
  const display = format(value);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  /** Where the caret belongs, counted in PLAIN characters — see below. */
  const caretRef = React.useRef<number | null>(null);

  /**
   * ★ PUTTING THE CARET BACK, MEASURED IN CHARACTERS THAT ARE REALLY THERE.
   *
   * Re-formatting on every keystroke rewrites the whole value, and a rewritten
   * value sends the caret to the end — so editing the middle of a value becomes
   * impossible: every character typed jumps you back to the end. Restoring a raw
   * offset does not work either, because inserting one character can also insert
   * a separator and shift everything right of it.
   *
   * So the position is remembered as a count of PLAIN characters, which is the
   * one measure formatting cannot change, and translated back into display
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
      if (isPlain(display[index] as string)) seen += 1;
    }

    target.setSelectionRange(position, position);
  });

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    const raw = target.value;
    const caret = target.selectionStart ?? raw.length;

    let plain = strip(raw);
    let plainCaret = countPlain(raw, caret, isPlain);

    /**
     * ★ BACKSPACE ON A SEPARATOR DELETES THE CHARACTER, NOT THE SEPARATOR.
     *
     * A separator is not something anybody typed, so removing one leaves the
     * payload identical and the formatter simply puts it back. Left alone that
     * reads as a broken key: the caret sits after the separator and Backspace
     * does nothing, forever. Deleting what the person actually meant is both the
     * expected behaviour and the only one that terminates.
     */
    if (plain === value && raw.length < display.length && plainCaret > 0) {
      plain = plain.slice(0, plainCaret - 1) + plain.slice(plainCaret);
      plainCaret -= 1;
    }

    caretRef.current = plainCaret;

    /**
     * An edit that leaves the payload untouched — deleting a leading separator,
     * typing one the formatter was going to add anyway — produces no state
     * change, so React re-renders nothing and the raw text would sit in the DOM
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

  return { ref: inputRef, value: display, onChange: handleChange };
}
