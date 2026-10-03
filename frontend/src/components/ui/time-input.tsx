import * as React from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import {
  NO_CLOCK_PARTS,
  PERIODS,
  blockedPicks,
  canonicalOf,
  displayClock12,
  parseClockTime,
  partsOf,
  type ClockParts,
} from './dateTimeText';
import { PickerColumn } from './picker-column';

type InputProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'ref'>;

export interface TimeInputProps extends InputProps {
  /** The hour as the form holds it: 24-hour `HH:mm`, or `''` while there is none. */
  value: string;
  /** Called with `HH:mm` once hour, minute and AM/PM are all chosen, and with `''` until then. */
  onChange: (value: string) => void;
  /** The earliest hour that may be picked (24-hour `HH:mm`); earlier choices are disabled. */
  min?: string;
  /** Which edge of the field the picker opens from. */
  align?: 'start' | 'end';
  /** A refusal from the form's own rules: becomes the control's validity, so a submit stops on it. */
  invalidMessage?: string | null;
  /** Told when the hour is half chosen, and when it is whole again. */
  onFormatError?: (message: string | null) => void;
}

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);
const pad2 = (value: number): string => String(value).padStart(2, '0');
const OPEN_KEYS = new Set(['Enter', ' ', 'ArrowDown', 'ArrowUp']);

/**
 * An hour, picked — click the field, choose the hour, the minute and AM or PM
 * — the way the native time picker worked, drawn by the Backoffice instead of
 * by the browser.
 *
 * ★ WHY NOT `<input type="time">`. The native control lays itself out in the
 * BROWSER's locale (an English Chrome shows `09:30 PM`, a Vietnamese one
 * `21:30`, the period sometimes first), so what a dispatcher saw depended on
 * the machine. Here the field reads `09:30 PM`, AM always comes before PM, and
 * every minute 00–59 can be chosen. The form is handed the same 24-hour
 * `HH:mm` the native control gave it: 09 : 30 : PM is `21:30`.
 *
 * The field takes no typing (a pasted `21:30` or `9:30 PM` is read). A half
 * chosen hour is no hour: the form is told `''` and the field is invalid, so a
 * submit stops on it — as the native control does with an incomplete hour.
 */
export function TimeInput({
  value,
  onChange,
  min,
  align = 'start',
  invalidMessage = null,
  onFormatError,
  id,
  className,
  disabled,
  onClick,
  ...rest
}: Readonly<TimeInputProps>) {
  const { t } = useLanguage();
  const field = React.useRef<HTMLInputElement>(null);
  const wrapper = React.useRef<HTMLDivElement>(null);
  const popupId = React.useId();
  const [parts, setParts] = React.useState<ClockParts>(() => partsOf(value));
  const [open, setOpen] = React.useState(false);

  // Follow the value when the form changes it; a half-chosen hour is the picker's own.
  React.useEffect(() => {
    setParts((current) => ((canonicalOf(current) ?? '') === value ? current : partsOf(value)));
  }, [value]);

  const choose = (next: ClockParts) => {
    setParts(next);
    onChange(canonicalOf(next) ?? '');
  };

  const incomplete = canonicalOf(parts) === null && displayClock12(parts) !== '' ? t('timePickerIncomplete') : null;
  // A half-chosen hour never submits; it is SAID once the picker is closed —
  // not while the hour, minute and AM/PM are still being chosen.
  React.useEffect(() => {
    field.current?.setCustomValidity(invalidMessage ?? incomplete ?? '');
    onFormatError?.(open ? null : incomplete);
  }, [invalidMessage, incomplete, open, onFormatError]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) field.current?.focus();
  };

  // A press anywhere else closes the picker.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && open) {
      // The picker's Escape, not the dialog's around it.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (OPEN_KEYS.has(event.key)) {
      event.preventDefault();
      if (!disabled) setOpen(true);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      choose(NO_CLOCK_PARTS);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      // The hour is picked, not typed.
      event.preventDefault();
    }
  };

  return (
    <div ref={wrapper} className="relative">
      <Clock aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-gray-400" />
      <Input
        ref={field}
        id={id}
        type="text"
        role="combobox"
        inputMode="none"
        autoComplete="off"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popupId}
        placeholder="--:-- --"
        value={displayClock12(parts)}
        disabled={disabled}
        onClick={(event) => {
          if (!disabled) setOpen((current) => !current);
          onClick?.(event);
        }}
        onKeyDown={onFieldKeyDown}
        onChange={(event) => {
          const pasted = parseClockTime(event.target.value);
          if (pasted) choose(partsOf(pasted));
        }}
        className={cn('cursor-pointer pl-8 caret-transparent tabular-nums', className)}
        {...rest}
      />
      <div id={popupId} hidden={!open}>
        {open ? <TimePickerPanel parts={parts} min={min} align={align} onChoose={choose} onClose={close} field={field} /> : null}
      </div>
    </div>
  );
}

/** The open picker: three columns — hour, minute, AM/PM — and Clear / Done. */
function TimePickerPanel({
  parts,
  min,
  align,
  onChoose,
  onClose,
  field,
}: Readonly<{
  parts: ClockParts;
  min?: string;
  align: 'start' | 'end';
  onChoose: (parts: ClockParts) => void;
  onClose: (refocus: boolean) => void;
  field: React.RefObject<HTMLInputElement | null>;
}>) {
  const { t } = useLanguage();
  const blocked = blockedPicks(min, parts);
  const panel = React.useRef<HTMLDialogElement>(null);
  const done = () => onClose(true);

  // Escape closes the picker — and only the picker, not the dialog around the
  // form; tabbing out of it closes it too, a press inside it does not.
  React.useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !element.contains(next) && next !== field.current) onClose(false);
    };
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('focusout', onFocusOut);
    return () => {
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('focusout', onFocusOut);
    };
  }, [onClose, field]);

  return (
    <dialog
      ref={panel}
      open
      aria-label={t('timePickerDialog')}
      className={cn(
        'absolute top-full z-50 m-0 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-2 text-gray-900 shadow-lg',
        align === 'end' ? 'right-0 left-auto' : 'right-auto left-0',
      )}
    >
      <div className="flex gap-1">
        <PickerColumn
          label={t('timePickerHour')}
          options={HOURS.map((hour) => ({ value: hour, text: pad2(hour), disabled: blocked.hour(hour) }))}
          selected={parts.hour}
          onSelect={(hour) => onChoose({ ...parts, hour })}
          onDone={done}
          autoFocus
        />
        <PickerColumn
          label={t('timePickerMinute')}
          options={MINUTES.map((minute) => ({
            value: minute,
            text: pad2(minute),
            disabled: blocked.minute(minute),
            emphasis: minute % 15 === 0,
          }))}
          selected={parts.minute}
          onSelect={(minute) => onChoose({ ...parts, minute })}
          onDone={done}
        />
        <PickerColumn
          label={t('timePickerPeriod')}
          options={PERIODS.map((period) => ({ value: period, text: period, disabled: blocked.period(period) }))}
          selected={parts.period}
          onSelect={(period) => onChoose({ ...parts, period })}
          onDone={done}
        />
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onChoose(NO_CLOCK_PARTS)}>
          {t('timePickerClear')}
        </Button>
        <Button type="button" size="sm" className="bg-blue-600 px-3 text-white hover:bg-blue-700" onClick={done}>
          {t('timePickerDone')}
        </Button>
      </div>
    </dialog>
  );
}
