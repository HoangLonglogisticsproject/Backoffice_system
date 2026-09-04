import { useState } from 'react';
import { Clock, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useCompletionQueue } from '@/hooks/trip/useCompletionReview';
import { formatCalendarDay } from '@/utils/format/datetime';
import { formatPlate } from '@/utils/format';
import { reviewErrorKey } from '@/utils/driverErrors';
import type { ExpenseDeclaration } from '@/types/driver';
import type { OperationalBoardRow, OperationalStage } from '@/types/operationalBoard';
import type { TranslationKey } from '@/types/translate';

/** The two answers a driver can give. `null` is the absence of a request. */
const DECLARATION_LABEL: Record<ExpenseDeclaration, TranslationKey> = {
  expenses: 'driverDeclaredExpenses',
  none: 'driverDeclaredNone',
};
import { CompletionReviewModal } from './components/CompletionReviewModal';

/**
 * The completion review queue.
 *
 * ★ THE QUEUE IS THE OPERATIONAL BOARD, FILTERED — NOT A SECOND ENDPOINT. A
 * completion waiting for a decision is a row whose `stage` is
 * `COMPLETION_PENDING`; one that was sent back is `COMPLETION_REJECTED`. A
 * dedicated "pending completions" endpoint would be the same query with a
 * WHERE, and a second source for one list is a second thing to keep in step.
 *
 * ★ AND EVERY COLUMN COMES FROM THE SERVER ALREADY DECIDED. The stage, both
 * delay figures and the accountability are computed there, from its clock. This
 * screen renders them; it recomputes none of them, so it cannot disagree with
 * the board an operator is looking at on another machine.
 *
 * ⚠ THE PERMISSION IS A COURTESY HERE, NOT A BOUNDARY. `trip.complete.review`
 * hides the two buttons; the server re-decides both routes on every request and
 * a caller who skipped this screen entirely would get a 403, not a decision.
 */

const STAGE_LABEL: Record<OperationalStage, TranslationKey> = {
  NO_DRIVER: 'stageNO_DRIVER',
  DRIVER_ASSIGNED: 'stageDRIVER_ASSIGNED',
  WAITING_PICKUP: 'stageWAITING_PICKUP',
  PICKUP_DELAYED: 'stagePICKUP_DELAYED',
  AT_PICKUP: 'stageAT_PICKUP',
  IN_TRANSIT: 'stageIN_TRANSIT',
  DELIVERY_DELAYED: 'stageDELIVERY_DELAYED',
  AT_DELIVERY: 'stageAT_DELIVERY',
  AWAITING_COMPLETION: 'stageAWAITING_COMPLETION',
  COMPLETION_PENDING: 'stageCOMPLETION_PENDING',
  COMPLETION_REJECTED: 'stageCOMPLETION_REJECTED',
  DONE: 'stageDONE',
};

export default function CompletionReviewPage() {
  const { t, language } = useLanguage();
  const { can } = useSession();

  // ★ NO DATE RANGE. The server answers with outstanding work, so a completion
  // submitted on the 30th cannot vanish from this screen on the 1st — and no
  // browser clock decides which business month it is.
  const { rows: queue, loading, error, reload } = useCompletionQueue();

  const [openTripId, setOpenTripId] = useState<string | null>(null);

  const mayReview = can('trip.complete.review');

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t('reviewTitle')}</h1>
        <Button variant="outline" size="sm" onClick={reload}>
          {t('driverRetry')}
        </Button>
      </div>

      {!mayReview ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('reviewNoPermission')}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {t(reviewErrorKey(error))}
        </p>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('driverLoading')}</p>
      ) : null}

      {!loading && queue.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('reviewQueueEmpty')}</p>
      ) : null}

      {!loading && queue.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('driverScheduled')}</TableHead>
                <TableHead>{t('driverCustomer')}</TableHead>
                <TableHead>{t('driverVehicle')}</TableHead>
                <TableHead>{t('reviewDriver')}</TableHead>
                <TableHead>{t('reviewStage')}</TableHead>
                <TableHead>{t('reviewDeclaration')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((row) => (
                <QueueRow
                  key={row.tripId}
                  row={row}
                  language={language}
                  onOpen={() => setOpenTripId(row.tripId)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {openTripId ? (
        <Modal isOpen onClose={() => setOpenTripId(null)} title={t('reviewTitle')}>
          <CompletionReviewModal
            tripId={openTripId}
            row={queue.find((row) => row.tripId === openTripId) ?? null}
            mayReview={mayReview}
            onClose={() => setOpenTripId(null)}
          />
        </Modal>
      ) : null}
    </section>
  );
}

function QueueRow({
  row,
  language,
  onOpen,
}: Readonly<{ row: OperationalBoardRow; language: 'vi' | 'en'; onOpen: () => void }>) {
  const { t } = useLanguage();

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        {formatCalendarDay(row.scheduledOn, language)}
      </TableCell>
      <TableCell>{row.customer?.name ?? '—'}</TableCell>
      <TableCell className="whitespace-nowrap">{formatPlate(row.vehicle?.plate) || '—'}</TableCell>
      <TableCell>{row.driver?.displayName ?? '—'}</TableCell>
      <TableCell>
        <Badge variant={row.stage === 'COMPLETION_REJECTED' ? 'destructive' : 'secondary'}>
          {row.stage === 'COMPLETION_REJECTED' ? (
            <XCircle aria-hidden />
          ) : (
            <Clock aria-hidden />
          )}
          {t(STAGE_LABEL[row.stage])}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        {/* ★ A LOOKUP PLUS ONE FLAT QUESTION. `null` is not a third
            declaration — it means no completion request exists yet — so it is
            asked separately rather than chained onto the two real answers. */}
        {row.expenseDeclaration ? t(DECLARATION_LABEL[row.expenseDeclaration]) : '—'}
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" onClick={onOpen}>
          {t('reviewOpen')}
        </Button>
      </TableCell>
    </TableRow>
  );
}
