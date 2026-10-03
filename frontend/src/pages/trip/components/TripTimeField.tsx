import { useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { DateTimeInput } from '@/components/ui/date-time-input';
import { TimeInput } from '@/components/ui/time-input';

/**
 * One temporal control of the trip form — a date, an hour, or a date AND an
 * hour — labelled by what it holds: "Ngày …" for a day, "Giờ …" for an hour,
 * "Thời gian …" for both.
 *
 * ★ SHOWN THE WAY VIETNAM WRITES IT, IN ANY BROWSER: `dd/mm/yyyy` and 24-hour
 * `HH:mm` (`DateInput`, `TimeInput`, `DateTimeInput`). The native controls
 * drew both in the browser's locale — `09:30 PM`, `10/03/2026` in an English
 * Chrome. The values the form holds are unchanged: `YYYY-MM-DD`, `HH:mm`,
 * `YYYY-MM-DDTHH:mm`.
 *
 * ★ A REFUSAL IS THE BROWSER'S TOO. The sentence goes into native constraint
 * validation (the control's `invalidMessage`), so the form's submit stops on
 * it, focuses this control and reads the reason — the path `required` already
 * takes, with no focus code of our own. The same sentence is drawn under the
 * field as it is typed, tied to it by `aria-describedby` and flagged by
 * `aria-invalid` — and so is a day or an hour typed in a shape that is not one.
 */
export function TripTimeField({
  id,
  label,
  type,
  value,
  onChange,
  error = null,
  hint,
  required = false,
  min,
  max,
  timeLabel,
}: Readonly<{
  id: string;
  label: string;
  type: 'date' | 'time' | 'datetime';
  value: string;
  onChange: (value: string) => void;
  /** The translated refusal, or `null` while the value is acceptable. */
  error?: string | null;
  hint?: string;
  required?: boolean;
  /** The picker's own bounds — a narrower calendar or list, never the rule (that is `error`, and the server's). */
  min?: string;
  max?: string;
  /** For `datetime`: the hour's own accessible name. */
  timeLabel?: string;
}>) {
  const [formatError, setFormatError] = useState<string | null>(null);
  const shown = error ?? formatError;

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [shown ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const shared = {
    id,
    value,
    onChange,
    invalidMessage: error,
    onFormatError: setFormatError,
    'aria-invalid': shown ? true : undefined,
    'aria-describedby': describedBy,
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      {type === 'date' && <DateInput {...shared} required={required} min={min} max={max} />}
      {type === 'time' && <TimeInput {...shared} required={required} min={min} />}
      {type === 'datetime' && <DateTimeInput {...shared} timeLabel={timeLabel ?? label} />}
      {hint && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}
      {shown && (
        <p id={errorId} role="alert" className="text-xs text-red-600">
          {shown}
        </p>
      )}
    </div>
  );
}
