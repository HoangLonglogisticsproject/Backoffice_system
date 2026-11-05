import { useId, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { fetchTripExportSnapshot } from '@/api/tripSchedule';
import { Button } from '@/components/ui/button';
import { displayCalendarDate } from '@/components/ui/dateTimeText';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { TRIP_EXPORT_SCOPE_LABELS, type TripExportScope, type TripLifecycle } from '@/types/trip';
import { cn } from '@/utils/cn';
import { downloadTripScheduleWorkbook } from '@/utils/export/tripScheduleWorkbook';
import { notifyApiError, notifyError, notifySuccess } from '@/utils/toast';

/**
 * The board, as a spreadsheet — the workbook it replaced, on demand.
 *
 * ★ THE BUTTON OPENS A DIALOG; THE DIALOG SAYS WHAT THE FILE WILL HOLD. The
 * range and the customer search are restated, and the scope is a choice:
 * this screen's trips — selected every time it opens — or both screens in
 * one table. "Both" is never what a click means by default: a file holding
 * rows from a screen the person was not looking at must be something they
 * picked, by name.
 *
 * ★ ONE SNAPSHOT, THE WHOLE RANGE. `fetchTripExportSnapshot` is one request the
 * server answers from one consistent read of every matching trip — never the
 * page on screen, never a walk of pages read at different instants.
 *
 * ★ AND ALWAYS THE WHOLE BOARD, NEVER ONE TAB'S HALF. The button only appears
 * on "tất cả" — the screens decide that — because an export named after a date
 * range that silently dropped every crewed trip would be read as the month's
 * record, and be wrong. The crew filter is pinned to `all` by the request.
 *
 * ★ AND THE CUSTOMER SEARCH GOES WITH IT, for the same reason the range does.
 * ⚠ IT IS THE APPLIED SEARCH, NOT THE BOX. A name half typed and never
 * submitted narrows nothing on screen, and must narrow nothing in the file
 * either — the two have to describe one set.
 *
 * ★ SUCCESS IS SAID ONLY ONCE THE FILE IS WRITTEN. Any failure before or
 * during the write — the read, an answer with no snapshot, SheetJS — is an
 * error toast, and the dialog stays open to try again.
 */
export function TripScheduleExportButton({
  range,
  lifecycle = 'operational',
  customer = '',
}: Readonly<{
  range: { from: string; to: string };
  /** The screen this button sits on — the scope the dialog opens on. */
  lifecycle?: TripLifecycle;
  /** The search the board is narrowed by. Empty = every customer. */
  customer?: string;
}>) {
  const { t } = useLanguage();
  const { can } = useSession();
  const radioName = useId();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<TripExportScope>(lifecycle);
  const [running, setRunning] = useState(false);

  const openDialog = () => {
    // Every opening starts from this screen — the choice of both is never remembered.
    setScope(lifecycle);
    setOpen(true);
  };
  const close = () => {
    if (!running) setOpen(false);
  };

  const run = async () => {
    setRunning(true);
    try {
      const snapshot = await fetchTripExportSnapshot({ ...range, customer, scope });

      // An empty range is not a failure, and it must not produce a file. A
      // workbook with a heading row and nothing under it looks exactly like a
      // broken export, and somebody would report it as one.
      if (snapshot.items.length === 0) {
        notifyError('exportEmpty');
        return;
      }

      // ★ THE KEYS THE SERVER ENFORCES FOR THIS FILE: `trip.price.read` for the
      // prices and `cost.export` for the cost block (DL-117). Without one the
      // server has already blanked those figures or never computed them; the
      // builder drops the columns instead of writing blanks. The layout follows
      // the session's capability — the data follows the server.
      const written = await downloadTripScheduleWorkbook({
        trips: snapshot.items,
        t,
        range,
        customer,
        readAt: snapshot.readAt,
        includePrices: can('trip.price.read'),
        includeCosts: can('cost.export'),
        scope,
      });
      setOpen(false);
      notifySuccess('exportDone', { description: `${written} ${t('exportRowsUnit')}` });
    } catch (error) {
      // The server's own words when it spoke; ours when the request never
      // arrived, carried no snapshot, or SheetJS failed.
      notifyApiError(error, 'exportFailed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" className="ml-auto h-9 gap-2 bg-white" onClick={openDialog}>
        <Download className="h-4 w-4" aria-hidden="true" />
        {t('exportExcel')}
      </Button>

      <Modal
        isOpen={open}
        onClose={close}
        title={t('exportExcel')}
        footer={
          <>
            <Button type="button" variant="outline" size="lg" onClick={close} disabled={running}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              size="lg"
              disabled={running}
              onClick={() => void run()}
              className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              {running ? t('exportRunning') : t('exportConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">{t('exportPickupRange')}</dt>
            <dd className="font-medium text-gray-900">
              {displayCalendarDate(range.from)} – {displayCalendarDate(range.to)}
            </dd>
            <dt className="text-gray-500">{t('colCustomer')}</dt>
            <dd className="font-medium text-gray-900">
              {customer ? `${t('exportCustomerContains')} “${customer}”` : t('exportAllCustomers')}
            </dd>
          </dl>

          <fieldset className="space-y-2" disabled={running}>
            <legend className="mb-2 text-sm font-medium text-gray-900">{t('exportScopeLegend')}</legend>
            {[lifecycle, 'all' as const].map((option) => (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm',
                  scope === option ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-gray-200 text-gray-800',
                )}
              >
                <input
                  type="radio"
                  name={radioName}
                  value={option}
                  checked={scope === option}
                  onChange={() => setScope(option)}
                  className="h-4 w-4 accent-blue-600"
                />
                {t(TRIP_EXPORT_SCOPE_LABELS[option])}
              </label>
            ))}
          </fieldset>

          <p className="text-sm text-gray-600">{t('exportExcludesArchived')}</p>
        </div>
      </Modal>
    </>
  );
}
