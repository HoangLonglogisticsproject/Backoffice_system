import { useId, type ReactNode } from 'react';

/**
 * One numbered part of the booking workspace — a white card with its step and
 * title, on the dialog's light grey. The steps read top to bottom the way a
 * dispatcher takes a booking down the phone: who and what, when, where, at
 * what price.
 */
export function BookingSection({
  step,
  title,
  aside,
  children,
}: Readonly<{ step: number; title: string; aside?: ReactNode; children: ReactNode }>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
        >
          {step}
        </span>
        <h3 id={id} className="text-sm font-semibold text-gray-900">
          {title}
        </h3>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </header>
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}
