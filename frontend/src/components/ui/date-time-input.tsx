import * as React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { DateInput } from './date-input';
import { TimeInput } from './time-input';

export interface DateTimeInputProps {
  /** The date part's id — what the field's `<label>` names. The hour is `${id}-time`. */
  id: string;
  /** The moment as the form holds it: `YYYY-MM-DDTHH:mm`, or `''` while it is not whole. */
  value: string;
  onChange: (value: string) => void;
  /** The hour's own accessible name, e.g. "Giờ giao hàng". */
  timeLabel: string;
  invalidMessage?: string | null;
  onFormatError?: (message: string | null) => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

const split = (value: string): [string, string] => {
  const [day = '', time = ''] = value ? value.split('T') : [];
  return [day, time];
};

/**
 * A day AND an hour — `05/10/2026` and a picked `09:30 AM` — the pair the
 * native `datetime-local` held, laid out by the Backoffice instead of by the
 * browser's locale.
 *
 * The form is handed `YYYY-MM-DDTHH:mm`, as before, only once both halves are
 * whole; one half without the other is incomplete, and says so on the half
 * that is missing.
 */
export function DateTimeInput({
  id,
  value,
  onChange,
  timeLabel,
  invalidMessage = null,
  onFormatError,
  ...aria
}: Readonly<DateTimeInputProps>) {
  const { t } = useLanguage();
  const [day, setDay] = React.useState(() => split(value)[0]);
  const [time, setTime] = React.useState(() => split(value)[1]);
  const [dayFormat, setDayFormat] = React.useState<string | null>(null);
  const [timeFormat, setTimeFormat] = React.useState<string | null>(null);

  // Follow the value when the form changes it; a half-entered pair is the field's own.
  React.useEffect(() => {
    if (value) {
      const [nextDay, nextTime] = split(value);
      setDay(nextDay);
      setTime(nextTime);
    }
  }, [value]);

  const choose = (nextDay: string, nextTime: string) => {
    setDay(nextDay);
    setTime(nextTime);
    onChange(nextDay && nextTime ? `${nextDay}T${nextTime}` : '');
  };

  const incomplete = (day === '') === (time === '') ? null : t('dateTimeIncomplete');
  React.useEffect(() => {
    onFormatError?.(dayFormat ?? timeFormat ?? incomplete);
  }, [dayFormat, timeFormat, incomplete, onFormatError]);

  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
      <DateInput
        id={id}
        value={day}
        onChange={(nextDay) => choose(nextDay, time)}
        invalidMessage={invalidMessage ?? (day === '' && time !== '' ? incomplete : null)}
        onFormatError={setDayFormat}
        {...aria}
      />
      <TimeInput
        id={`${id}-time`}
        aria-label={timeLabel}
        align="end"
        value={time}
        onChange={(nextTime) => choose(day, nextTime)}
        invalidMessage={time === '' && day !== '' ? incomplete : null}
        onFormatError={setTimeFormat}
        {...aria}
      />
    </div>
  );
}
