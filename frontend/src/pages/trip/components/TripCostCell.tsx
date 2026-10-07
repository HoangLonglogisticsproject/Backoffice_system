import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import { formatMoney } from '@/utils/format/money';
import type { TripCostSummary } from '@/types/tripBoard';

/**
 * What one trip has cost, on its board row — and the way into the cost dialog.
 *
 * ★ THREE STATES, AND ONLY ONE OF THEM IS A NUMBER.
 *
 *   no summary       a dash — the figure is not known here. Never "0": the
 *                    server sends `null` when it did not compute one, and a
 *                    zero would claim the trip cost nothing.
 *   nothing yet      "Chưa có" — the server counted, and there is no live line.
 *   a total          the amount, with how many lines make it up.
 *
 * ★ THE SAME FIGURE AS THE DIALOG'S "Tổng chi phí chuyến", computed by the
 * server from the same records. Nothing here adds anything up.
 *
 * ⚠ A COURTESY, NOT A BOUNDARY. The column is only drawn for `cost.read`, but
 * what keeps the money from anybody else is the server never sending it.
 */
export function TripCostCell({
  summary,
  onOpen,
  className,
}: Readonly<{
  /**
   * Only the two figures a cell shows. `undefined` for a server that predates
   * the field — the same "not known".
   */
  summary: Pick<TripCostSummary, 'total' | 'itemCount'> | null | undefined;
  onOpen: () => void;
  /** A table column right-aligns it (the default); the detail panel reads it left to right. */
  className?: string;
}>) {
  const { t } = useLanguage();

  if (!summary) {
    return (
      <span className="text-gray-400">
        —<span className="sr-only">{t('tripCostUnknown')}</span>
      </span>
    );
  }

  const empty = summary.itemCount === 0;
  const amount = empty ? t('tripCostNone') : formatMoney(summary.total);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${t('tripCost')}: ${amount}`}
      className={cn(
        'group w-full rounded-md px-1 py-0.5 text-right outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      {empty ? (
        <span className="text-gray-400 group-hover:text-blue-700">{amount}</span>
      ) : (
        <>
          <span className="block font-medium whitespace-nowrap tabular-nums text-gray-900 group-hover:text-blue-700">
            {amount}
          </span>
          <span className="block text-xs whitespace-nowrap text-gray-500">
            {summary.itemCount} {t('tripCostItems')}
          </span>
        </>
      )}
    </button>
  );
}
