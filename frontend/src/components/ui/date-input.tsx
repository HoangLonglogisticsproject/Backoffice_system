import * as React from 'react';
import { CalendarDays } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import { displayCalendarDate, maskCalendarDate, parseCalendarDate } from './dateTimeText';

type InputProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'ref'>;

export interface DateInputProps extends InputProps {
  /** The day as the form holds it: `YYYY-MM-DD`, or `''` while there is none. */
  value: string;
  /** Called with `YYYY-MM-DD` once a whole day is typed or picked, and with `''` until then. */
  onChange: (value: string) => void;
  /** The calendar's bounds (`YYYY-MM-DD`). The rule itself is the form's, said through `invalidMessage`. */
  min?: string;
  max?: string;
  /** A refusal from the form's own rules: becomes the control's validity, so a submit stops on it. */
  invalidMessage?: string | null;
  /** Told when the text typed is not a day, and when it is again. */
  onFormatError?: (message: string | null) => void;
}

/**
 * A day, always shown as Vietnam writes it — `03/10/2026` — whatever language
 * the browser runs in.
 *
 * ★ WHY NOT `<input type="date">` ON ITS OWN. The native field draws the day in
 * the BROWSER's locale: an English Chrome shows `10/03/2026` for 3 October,
 * which reads as 10 March here. This field is text — `03/10/2026`,
 * `03102026`, or a pasted `2026-10-03` — and its button opens the browser's
 * own calendar, whose pick is shown back in `dd/mm/yyyy`. The form is handed
 * the same `YYYY-MM-DD` the native field gave it.
 *
 * The calendar input is never invalid on its own: it holds a value only while
 * a pick is being made, so the browser's checks stop on the visible field.
 */
export function DateInput({
  value,
  onChange,
  min,
  max,
  invalidMessage = null,
  onFormatError,
  id,
  className,
  disabled,
  onBlur,
  ...rest
}: Readonly<DateInputProps>) {
  const { t } = useLanguage();
  const input = React.useRef<HTMLInputElement>(null);
  const calendar = React.useRef<HTMLInputElement>(null);
  const [draft, setDraft] = React.useState(() => displayCalendarDate(value));

  // Follow the value when the form changes it, never while a day is half-typed.
  React.useEffect(() => {
    setDraft((current) => ((parseCalendarDate(current) ?? '') === value ? current : displayCalendarDate(value)));
  }, [value]);

  const formatError = draft !== '' && parseCalendarDate(draft) === null ? t('dateFormatInvalid') : null;
  React.useEffect(() => {
    input.current?.setCustomValidity(invalidMessage ?? formatError ?? '');
    onFormatError?.(formatError);
  }, [invalidMessage, formatError, onFormatError]);

  const openCalendar = () => {
    const picker = calendar.current;
    if (!picker) return;
    picker.value = value;
    try {
      picker.showPicker();
    } catch {
      // No picker in this browser: typing the day is the way.
      input.current?.focus();
    }
  };

  return (
    <div className="relative">
      <Input
        ref={input}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        maxLength={10}
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          const next = maskCalendarDate(event.target.value);
          const day = parseCalendarDate(next);
          // A pasted `2026-10-03` is shown the way the field shows days.
          setDraft(day && next.includes('-') ? displayCalendarDate(day) : next);
          onChange(day ?? '');
        }}
        onBlur={(event) => {
          // `3/10/2026` becomes `03/10/2026` once the field is left.
          const day = parseCalendarDate(draft);
          if (day) setDraft(displayCalendarDate(day));
          onBlur?.(event);
        }}
        className={cn('pr-9 tabular-nums', className)}
        {...rest}
      />
      <input
        ref={calendar}
        id={id ? `${id}-calendar` : undefined}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const day = event.target.value;
          event.target.value = '';
          if (!day) return;
          setDraft(displayCalendarDate(day));
          onChange(day);
        }}
        className="pointer-events-none absolute bottom-0 left-0 h-px w-full opacity-0"
      />
      <button
        type="button"
        onClick={openCalendar}
        disabled={disabled}
        aria-label={t('chooseDate')}
        className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-gray-400 outline-none hover:text-gray-600 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none"
      >
        <CalendarDays className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
