import * as React from 'react';

import { Input } from '@/components/ui/input';
import { useFormattedInput } from '@/hooks/useFormattedInput';
import { formatPlate, stripPlate } from '@/utils/format';

/**
 * A registration plate field that reads as a plate while it is being typed.
 *
 * ★ THE STATE IS THE PAYLOAD, THE DISPLAY IS A VIEW OF IT — the same contract
 * `MoneyInput` keeps, over the same `useFormattedInput`. `value` and `onChange`
 * speak the PLAIN plate — `"50AA123333"` — which is exactly what
 * `POST /trip-vehicles` takes and exactly what 0011 computes `plate_key` to be.
 * The dash exists only between `formatPlate` and the DOM.
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
  const field = useFormattedInput({
    value,
    onChange,
    format: formatPlate,
    strip: stripPlate,
    // ⚠ ONLY LETTERS AND DIGITS COUNT, unlike the money field. `stripPlate`
    // drops a pasted `.` or space outright, so those characters are not in the
    // payload and the caret must not count them as if they were.
    isPlain: (char) => /[A-Za-z0-9]/.test(char),
  });

  return (
    <Input
      // Plates are letters and digits, and a phone keyboard that opens on
      // letters is the right one — the province code is two taps either way.
      autoCapitalize="characters"
      autoComplete="off"
      spellCheck={false}
      {...field}
      {...props}
    />
  );
}
