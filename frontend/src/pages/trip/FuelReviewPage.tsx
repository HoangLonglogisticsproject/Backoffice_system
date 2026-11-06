import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useFuelReviews } from '@/hooks/trip/useFuelReviews';
import type { FuelReviewStatus } from '@/types/fuel';
import { cn } from '@/utils/cn';
import { formatPlate } from '@/utils/format';
import { formatDateTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { FUEL_STATUS_LABEL, FUEL_STATUS_TONE } from '@/utils/fuelStatus';
import { FuelReviewDetailDialog } from './fuel/FuelReviewDetailDialog';

const TABS: readonly FuelReviewStatus[] = ['submitted', 'needs_info', 'approved', 'paid', 'rejected'];

/**
 * "Kế toán → Nhiên liệu" — the drivers' fills, by where Accounting's check
 * stands (`cost.import`, 0038).
 *
 * ★ ACCOUNTING CHECKS, THE DRIVER RECORDS. Every row was recorded by a driver
 * on the lorry they ran, with their photos; here it is asked about, refused,
 * approved, and — once paid in the bank app or by the station's QR — marked
 * paid. Nothing is paid by this screen; refusing a fill withdraws its cost from
 * the lorry's ledger (the server does it, in the same transaction).
 */
export default function FuelReviewPage() {
  const { t, language } = useLanguage();
  const { can } = useSession();
  const [status, setStatus] = useState<FuelReviewStatus>('submitted');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const reviews = useFuelReviews(status, page);
  const lastPage = Math.max(reviews.data?.totalPages ?? 1, 1);
  // Deciding the last fill of a page shrinks the queue under it: follow it back rather than show an empty page —
  // once that page has answered. A page still loading has no count yet, and is not "past the end".
  const answered = reviews.data !== undefined;
  useEffect(() => {
    if (answered && page > lastPage) setPage(lastPage);
  }, [answered, page, lastPage]);

  if (!can('cost.import')) return <PageHeader title={t('fuelReviews')} subtitle={t('fuelReceiptsNoAccess')} />;
  const data = reviews.data;

  return (
    <div className="space-y-4">
      <PageHeader title={t('fuelReviews')} subtitle={t('fuelReviewsSubtitle')} />
      <div role="tablist" aria-label={t('fuelReviews')} className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={status === tab}
            onClick={() => {
              setStatus(tab);
              setPage(1);
            }}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm font-medium',
              status === tab ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300',
            )}
          >
            {t(FUEL_STATUS_LABEL[tab])}
          </button>
        ))}
      </div>

      {reviews.isError ? <p role="alert" className="text-sm text-red-600">{t('loadFailed')}</p> : null}
      <div role="tabpanel" aria-label={t(FUEL_STATUS_LABEL[status])} className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <Table>
          <TableHeader className="bg-gray-50/50">
            <TableRow>
              <TableHead>{t('fuelColWhen')}</TableHead>
              <TableHead>{t('fuelVehicle')}</TableHead>
              <TableHead>{t('fuelColDriver')}</TableHead>
              <TableHead className="text-right">{t('fuelAmount')}</TableHead>
              <TableHead className="text-right">{t('fuelLiters')}</TableHead>
              <TableHead>{t('fuelVendorName')}</TableHead>
              <TableHead className="text-right">{t('fuelImagesLabel')}</TableHead>
              <TableHead>{t('fuelColStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviews.isPending ? (
              <TableRow>
                <TableCell colSpan={8} role="status" className="py-8 text-center text-sm text-gray-500">{t('loading')}</TableCell>
              </TableRow>
            ) : null}
            {data?.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-gray-500">{t('fuelReviewsEmpty')}</TableCell>
              </TableRow>
            ) : null}
            {(data?.items ?? []).map((fill) => (
              <TableRow key={fill.fuelTransactionId} className="cursor-pointer hover:bg-blue-50/40" onClick={() => setOpen(fill.fuelTransactionId)}>
                <TableCell className="whitespace-nowrap">
                  <button type="button" className="text-left font-medium text-blue-700 hover:underline" onClick={() => setOpen(fill.fuelTransactionId)}>
                    {formatDateTime(fill.occurredAt ?? fill.recordedAt, language)}
                  </button>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatPlate(fill.vehicle.plate)}</TableCell>
                <TableCell>{fill.driver?.displayName ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(fill.amount)}</TableCell>
                <TableCell className="text-right tabular-nums">{fill.liters ?? '—'}</TableCell>
                <TableCell>{fill.vendor?.name ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{fill.evidenceCount}</TableCell>
                <TableCell>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', FUEL_STATUS_TONE[fill.status])}>
                    {t(FUEL_STATUS_LABEL[fill.status])}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {data && data.totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('previousPage')}</Button>
          <span>{page} / {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>{t('nextPage')}</Button>
        </div>
      ) : null}

      {open ? <FuelReviewDetailDialog id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
