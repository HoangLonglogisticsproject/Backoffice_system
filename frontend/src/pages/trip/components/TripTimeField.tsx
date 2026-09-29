import { useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';

/**
 * One temporal control of the trip form — a date, an hour, or a date AND an
 * hour — labelled by what it holds: "Ngày …" for a day, "Giờ …" for an hour,
 * "Thời gian …" for both.
 *
 * ★ A REFUSAL IS THE BROWSER'S TOO. `setCustomValidity` puts the sentence into
 * native constraint validation, so the form's submit stops on it, focuses this
 * control and reads the reason — the path `required` already takes, with no
 * focus code of our own. The same sentence is drawn under the field as it is
 * typed, tied to it by `aria-describedby` and flagged by `aria-invalid`.
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
}: Readonly<{
  id: string;
  label: string;
  type: 'date' | 'time' | 'datetime-local';
  value: string;
  onChange: (value: string) => void;
  /** The translated refusal, or `null` while the value is acceptable. */
  error?: string | null;
  hint?: string;
  required?: boolean;
}>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.setCustomValidity(error ?? '');
  }, [error]);

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <Input
        ref={ref}
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
