import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { fetchAllTripSchedules } from '@/api/tripSchedule';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { downloadTripScheduleWorkbook } from '@/utils/export/tripScheduleWorkbook';
import { notifyApiError, notifyError, notifySuccess } from '@/utils/toast';

/**
 * The board, as a spreadsheet — the workbook it replaced, on demand.
 *
 * ★ IT EXPORTS THE WHOLE RANGE, NOT THE PAGE ON SCREEN. Anything else would be
 * a trap: the table shows fifty rows of a month that may hold four hundred, and
 * a file quietly containing the first fifty is worse than no file, because
 * nothing about it says which rows are missing. `fetchAllTripSchedules` walks
 * every page for the same range the board is showing.
 *
 * ★ AND ALWAYS THE WHOLE BOARD, NEVER ONE TAB'S HALF. The button only appears
 * on "tất cả" for exactly that reason — an export named after a date range that
 * silently dropped every crewed trip would be read as the month's record, and
 * be wrong. On the other tabs there is no button rather than a button that
 * means something different.
 *
 * ★ NO SPINNER OVER THE TABLE, ONLY IN THE BUTTON. The board behind stays
 * usable while a long range downloads; the one control that must not be pressed
 * twice is this one, and it disables itself.
 */
export function TripScheduleExportButton({
  range,
}: Readonly<{ range: { from: string; to: string } }>) {
  const { t, language } = useLanguage();
  const { can } = useSession();
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      // `assignment` is pinned to the whole board rather than passed in — see
      // the note above about which rows this file is understood to contain.
      const trips = await fetchAllTripSchedules({ ...range, assignment: 'all' });

      // An empty range is not a failure, and it must not produce a file. A
      // workbook with a heading row and nothing under it looks exactly like a
      // broken export, and somebody would report it as one.
      if (trips.length === 0) {
        notifyError('exportEmpty');
        return;
      }

      // ★ THE SAME PERMISSION THE BOARD'S COLUMNS ARE GATED ON. Without it the
      // server has already blanked both figures, so the sheet would carry two
      // columns of empty cells reading as "nothing is priced"; the builder
      // drops the columns instead.
      const written = await downloadTripScheduleWorkbook({
        trips,
        t,
        language,
        range,
        includePrices: can('trip.price.read'),
      });
      notifySuccess('exportDone', {
        description: `${written} ${t('exportRowsUnit')}`,
      });
    } catch (error) {
      // The server's own words when it spoke; ours when the request never
      // arrived or SheetJS failed to load.
      notifyApiError(error, 'exportFailed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="ml-auto h-9 gap-2 bg-white"
      disabled={running}
      onClick={() => void run()}
    >
      {running ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="h-4 w-4" aria-hidden="true" />
      )}
      {running ? t('exportRunning') : t('exportExcel')}
    </Button>
  );
}
