import { useId } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TripCustomer } from '@/types/trip';
import { TripStatusBadge } from '../components/TripStatusBadge';
import type { TripEntry } from '../entry/useTripEntryForm';
import { summaryRows } from './bookingSummaryRows';

/**
 * "Tóm tắt booking" — the booking as it will be created, beside the form on a
 * wide screen and after it on a narrow one. It opens `pending` (Chờ xử lý):
 * the server sets that, and the badge only says so.
 */
export function BookingSummary({
  entry,
  customers,
  className,
}: Readonly<{ entry: TripEntry; customers: TripCustomer[]; className?: string }>) {
  const { t } = useLanguage();
  const id = useId();
  const customer = customers.find((row) => row.id === entry.form.customerId);
  const rows = summaryRows(
    entry.form,
    { pickup: entry.placeAt('pickup'), delivery: entry.placeAt('delivery') },
    customer?.name ?? null,
    entry.mayViewPrices,
    t,
  );

  return (
    <aside aria-labelledby={id} className={className}>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <h3 id={id} className="text-sm font-semibold text-gray-900">
            {t('bookingSummaryTitle')}
          </h3>
          <TripStatusBadge status="pending" />
        </header>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">{t('bookingSummaryEmpty')}</p>
        ) : (
          <dl className="divide-y divide-gray-100">
            {rows.map((row) => (
              <div key={row.key} className="space-y-0.5 px-4 py-2.5" data-summary={row.key}>
                <dt className="text-xs text-gray-500">{row.label}</dt>
                <dd className="text-sm font-medium break-words text-gray-900 tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </aside>
  );
}
